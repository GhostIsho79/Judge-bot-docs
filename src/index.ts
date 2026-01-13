import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  type Interaction,
} from "discord.js";
import { buildTrialCommand } from "./commands/trial";
import { createOpenAIClient } from "./services/ai";

const token = process.env.DISCORD_TOKEN;
const openaiKey = process.env.OPENAI_API_KEY;

if (!token || !openaiKey) {
  throw new Error("DISCORD_TOKEN and OPENAI_API_KEY must be set.");
}

const config = {
  courtroomChannelId: process.env.COURTROOM_CHANNEL_ID ?? "",
  rulesChannelId: process.env.RULES_CHANNEL_ID ?? "",
  modLogChannelId: process.env.MODLOG_CHANNEL_ID ?? "",
  rulesMessageId: process.env.RULES_MESSAGE_ID,
  inCourtRoleName: process.env.IN_COURT_ROLE_NAME ?? "IN_COURT",
  evidenceMaxMessages: Number(process.env.EVIDENCE_MAX_MESSAGES_PER_CHANNEL ?? 50),
  evidenceMaxDays: Number(process.env.EVIDENCE_MAX_DAYS ?? 7),
};

const modelName = process.env.MODEL_NAME ?? "gpt-4o-mini";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const aiClient = createOpenAIClient(openaiKey);
const sessions = new Map();
const cooldowns = new Map();

const trialCommand = buildTrialCommand({
  sessions,
  aiClient,
  modelName,
  config,
  cooldowns,
});

const commands = [trialCommand.data.toJSON()];

client.once("ready", async () => {
  if (!client.user) {
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const guildId = process.env.GUILD_ID;

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
      body: commands,
    });
  } else {
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands,
    });
  }

  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "trial") {
    await trialCommand.execute(interaction);
  }
});

client.login(token);
