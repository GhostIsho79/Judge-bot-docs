import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
  type GuildMember,
  PermissionFlagsBits,
} from "discord.js";
import { collectEvidence, truncateForDisplay } from "../services/evidence";
import { loadRulesFromChannel } from "../services/rules";
import { ensureCourtRole, applyCourtroomIsolation, removeCourtroomIsolation } from "../services/permissions";
import { runLawyer, runJudge, type LawyerOutput, type JudgeOutput } from "../services/ai";
import type OpenAI from "openai";

export interface TrialSession {
  caseId: string;
  guildId: string;
  suspectId: string;
  suspectTag: string;
  reason?: string | null;
  startedBy: string;
  startedAt: Date;
  evidence: Awaited<ReturnType<typeof collectEvidence>> | null;
  rulesText: string;
  rulesParsed: Awaited<ReturnType<typeof loadRulesFromChannel>>["parsedRules"];
  lawyerOutput: LawyerOutput | null;
  judgeOutput: JudgeOutput | null;
  courtroomChannelId: string;
  modLogChannelId: string;
  roleId: string;
  lastActionAt: number;
}

export interface TrialContext {
  sessions: Map<string, TrialSession>;
  aiClient: OpenAI;
  modelName: string;
  config: {
    courtroomChannelId: string;
    rulesChannelId: string;
    modLogChannelId: string;
    rulesMessageId?: string;
    inCourtRoleName: string;
    evidenceMaxMessages: number;
    evidenceMaxDays: number;
  };
  cooldowns: Map<string, number>;
}

const COOLDOWN_MS = 5000;

function checkCooldown(interaction: ChatInputCommandInteraction, context: TrialContext): boolean {
  const key = `${interaction.user.id}:${interaction.commandName}:${interaction.options.getSubcommand()}`;
  const last = context.cooldowns.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return false;
  }
  context.cooldowns.set(key, Date.now());
  return true;
}

function requireMod(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers) ||
    false;
}

function buildCaseId(): string {
  return `CASE-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

async function sendInChunks(channel: TextChannel, text: string, maxLength = 1900): Promise<void> {
  if (text.length <= maxLength) {
    await channel.send(text);
    return;
  }

  let remaining = text;
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, maxLength);
    remaining = remaining.slice(maxLength);
    await channel.send(chunk);
  }
}

function formatDefense(defense: LawyerOutput): string {
  return `Defense Summary: ${defense.defense_summary}\n` +
    `Mitigating Factors: ${defense.mitigating_factors.join(", ") || "None"}\n` +
    `Alternative Actions: ${defense.alternative_actions.join(", ") || "None"}\n` +
    `Repair Suggestion: ${defense.apology_or_repair_suggestion}`;
}

function formatVerdict(verdict: JudgeOutput): string {
  const violations = verdict.alleged_violations
    .map(
      (violation) =>
        `Rule ${violation.rule_id}: ${violation.rule_quote} (confidence ${violation.confidence_0_1})`
    )
    .join("\n");

  return [
    `Summary: ${verdict.summary}`,
    `Alleged Violations:\n${violations || "None"}`,
    `Recommended Action: ${verdict.recommended_action}`,
    verdict.recommended_action === "timeout"
      ? `Recommended Duration: ${verdict.recommended_duration_minutes ?? "unspecified"} minutes`
      : null,
    `Fairness Notes: ${verdict.fairness_notes.join("; ") || "None"}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

async function ensureSession(interaction: ChatInputCommandInteraction, context: TrialContext): Promise<TrialSession> {
  const guildId = interaction.guildId;
  if (!guildId) {
    throw new Error("Command must be used in a guild.");
  }

  const session = context.sessions.get(guildId);
  if (!session) {
    throw new Error("No active trial. Start one with /trial start.");
  }

  return session;
}

export function buildTrialCommand(context: TrialContext) {
  const data = new SlashCommandBuilder()
    .setName("trial")
    .setDescription("Run courtroom moderation flow")
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start a trial")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Suspect user")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("reason").setDescription("Reason for the trial")
        )
    )
    .addSubcommand((sub) =>
      sub.setName("evidence").setDescription("Show evidence summary")
    )
    .addSubcommand((sub) =>
      sub.setName("defense").setDescription("Run AI Lawyer defense")
    )
    .addSubcommand((sub) =>
      sub.setName("verdict").setDescription("Run AI Judge verdict")
    )
    .addSubcommand((sub) =>
      sub
        .setName("confirm")
        .setDescription("Confirm a moderator action")
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Action to take")
            .setRequired(true)
            .addChoices(
              { name: "none", value: "none" },
              { name: "warning", value: "warning" },
              { name: "timeout", value: "timeout" },
              { name: "kick", value: "kick" },
              { name: "ban", value: "ban" }
            )
        )
        .addIntegerOption((option) =>
          option
            .setName("duration")
            .setDescription("Timeout duration in minutes")
        )
    )
    .addSubcommand((sub) =>
      sub.setName("end").setDescription("End the trial")
    );

  async function execute(interaction: ChatInputCommandInteraction) {
    if (!requireMod(interaction)) {
      await interaction.reply({
        content: "You do not have permission to run courtroom commands.",
        ephemeral: true,
      });
      return;
    }

    if (!checkCooldown(interaction, context)) {
      await interaction.reply({
        content: "Slow down! Please wait a moment before retrying.",
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "start") {
      if (context.sessions.has(interaction.guildId ?? "")) {
        await interaction.reply({
          content: "A trial is already active in this guild. End it before starting another.",
          ephemeral: true,
        });
        return;
      }

      const suspect = interaction.options.getMember("user") as GuildMember | null;
      if (!suspect) {
        await interaction.reply({ content: "Suspect not found.", ephemeral: true });
        return;
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: "Guild not found.", ephemeral: true });
        return;
      }

      const courtroomChannel = guild.channels.cache.get(context.config.courtroomChannelId) as
        | TextChannel
        | undefined;
      const rulesChannel = guild.channels.cache.get(context.config.rulesChannelId) as
        | TextChannel
        | undefined;
      const modLogChannel = guild.channels.cache.get(context.config.modLogChannelId) as
        | TextChannel
        | undefined;

      if (!courtroomChannel || !rulesChannel || !modLogChannel) {
        await interaction.reply({
          content: "Required channels are not configured correctly.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const role = await ensureCourtRole({
        guild,
        roleName: context.config.inCourtRoleName,
      });

      await applyCourtroomIsolation({
        guild,
        suspect,
        role,
        courtroomChannel,
      });

      const evidence = await collectEvidence({
        guild,
        suspectId: suspect.id,
        maxMessagesPerChannel: context.config.evidenceMaxMessages,
        maxDays: context.config.evidenceMaxDays,
      });
      const rules = await loadRulesFromChannel({
        rulesChannel,
        rulesMessageId: context.config.rulesMessageId,
      });

      const caseId = buildCaseId();
      const session: TrialSession = {
        caseId,
        guildId: guild.id,
        suspectId: suspect.id,
        suspectTag: suspect.user.tag,
        reason: interaction.options.getString("reason"),
        startedBy: interaction.user.tag,
        startedAt: new Date(),
        evidence,
        rulesText: rules.rawText,
        rulesParsed: rules.parsedRules,
        lawyerOutput: null,
        judgeOutput: null,
        courtroomChannelId: courtroomChannel.id,
        modLogChannelId: modLogChannel.id,
        roleId: role.id,
        lastActionAt: Date.now(),
      };

      context.sessions.set(guild.id, session);

      await courtroomChannel.send(
        `🧑‍⚖️ Case opened (${caseId}) for <@${suspect.id}>. Reason: ${session.reason ?? "No reason provided."}`
      );
      await modLogChannel.send(
        `Case opened (${caseId}) by ${interaction.user.tag} for ${suspect.user.tag}. Evidence summary: ${evidence.summary}`
      );

      await interaction.editReply({
        content: `Trial started. Case ID: ${caseId}`,
      });
      return;
    }

    if (subcommand === "evidence") {
      const session = await ensureSession(interaction, context);
      const guild = interaction.guild!;
      const courtroomChannel = guild.channels.cache.get(session.courtroomChannelId) as TextChannel;
      const modLogChannel = guild.channels.cache.get(session.modLogChannelId) as TextChannel;
      if (!session.evidence) {
        await interaction.reply({ content: "No evidence available.", ephemeral: true });
        return;
      }

      await interaction.reply({ content: "Posting evidence summary.", ephemeral: true });
      await courtroomChannel.send(
        `Evidence summary for ${session.suspectTag}:\n${truncateForDisplay(session.evidence.caseFile)}`
      );
      if (session.evidence.caseFile.length > 1800) {
        await sendInChunks(
          modLogChannel,
          `Full evidence for ${session.suspectTag} (case ${session.caseId}):\n${session.evidence.caseFile}`
        );
      }
      return;
    }

    if (subcommand === "defense") {
      const session = await ensureSession(interaction, context);
      const guild = interaction.guild!;
      const courtroomChannel = guild.channels.cache.get(session.courtroomChannelId) as TextChannel;
      const modLogChannel = guild.channels.cache.get(session.modLogChannelId) as TextChannel;

      await interaction.deferReply({ ephemeral: true });
      const defense = await runLawyer({
        client: context.aiClient,
        model: context.modelName,
        rules: session.rulesParsed,
        evidence: session.evidence?.messages ?? [],
        suspectTag: session.suspectTag,
      });
      session.lawyerOutput = defense;

      const defenseText = formatDefense(defense);
      await courtroomChannel.send(`🛡️ Defense Statement:\n${truncateForDisplay(defenseText)}`);
      await sendInChunks(
        modLogChannel,
        `Defense statement for case ${session.caseId}:\n${defenseText}`
      );
      await interaction.editReply({ content: "Defense generated." });
      return;
    }

    if (subcommand === "verdict") {
      const session = await ensureSession(interaction, context);
      const guild = interaction.guild!;
      const courtroomChannel = guild.channels.cache.get(session.courtroomChannelId) as TextChannel;
      const modLogChannel = guild.channels.cache.get(session.modLogChannelId) as TextChannel;

      await interaction.deferReply({ ephemeral: true });
      const verdict = await runJudge({
        client: context.aiClient,
        model: context.modelName,
        rules: session.rulesParsed,
        evidence: session.evidence?.messages ?? [],
        suspectTag: session.suspectTag,
        lawyerOutput: session.lawyerOutput,
      });
      session.judgeOutput = verdict;

      const verdictJson = truncateForDisplay(JSON.stringify(verdict, null, 2), 1500);
      await courtroomChannel.send(
        `⚖️ Verdict for case ${session.caseId}:\n${truncateForDisplay(formatVerdict(verdict))}\n\nJSON:\n\`\`\`json\n${verdictJson}\n\`\`\``
      );
      await sendInChunks(
        modLogChannel,
        `Verdict JSON for case ${session.caseId}:\n${JSON.stringify(verdict, null, 2)}`
      );
      await interaction.editReply({ content: "Verdict generated." });
      return;
    }

    if (subcommand === "confirm") {
      const session = await ensureSession(interaction, context);
      const guild = interaction.guild!;
      const action = interaction.options.getString("action", true);
      const duration = interaction.options.getInteger("duration") ?? undefined;
      const member = await guild.members.fetch(session.suspectId);
      const modLogChannel = guild.channels.cache.get(session.modLogChannelId) as TextChannel;

      await interaction.deferReply({ ephemeral: true });

      if (action === "warning") {
        await member.send(
          `You have received a warning from the moderators. Case ${session.caseId}.`
        ).catch(() => null);
      } else if (action === "timeout") {
        if (!duration) {
          await interaction.editReply({ content: "Timeout duration is required." });
          return;
        }
        await member.timeout(duration * 60 * 1000, `Case ${session.caseId}`);
      } else if (action === "kick") {
        await member.kick(`Case ${session.caseId}`);
      } else if (action === "ban") {
        await member.ban({ reason: `Case ${session.caseId}` });
      }

      await modLogChannel.send(
        `Moderator ${interaction.user.tag} confirmed action '${action}' for case ${session.caseId}. Duration: ${duration ?? "n/a"}.`
      );
      await interaction.editReply({ content: `Action '${action}' applied.` });
      return;
    }

    if (subcommand === "end") {
      const session = await ensureSession(interaction, context);
      const guild = interaction.guild!;
      const member = await guild.members.fetch(session.suspectId);
      const role = guild.roles.cache.get(session.roleId);
      const courtroomChannel = guild.channels.cache.get(session.courtroomChannelId) as TextChannel;
      const modLogChannel = guild.channels.cache.get(session.modLogChannelId) as TextChannel;

      await interaction.deferReply({ ephemeral: true });

      if (role) {
        await removeCourtroomIsolation({ suspect: member, role });
      }

      await courtroomChannel.send(
        `🔒 Case ${session.caseId} closed. Thank you for participating.`
      );
      await modLogChannel.send(
        `Case ${session.caseId} closed by ${interaction.user.tag}.`
      );
      context.sessions.delete(guild.id);

      await interaction.editReply({ content: "Trial ended and suspect restored." });
      return;
    }
  }

  return { data, execute };
}
