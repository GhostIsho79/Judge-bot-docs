import type { TextChannel } from "discord.js";

export interface ParsedRule {
  id: string;
  text: string;
}

export function parseRules(rawText: string): ParsedRule[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rules: ParsedRule[] = [];
  let counter = 1;
  for (const line of lines) {
    const match = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (match) {
      rules.push({ id: match[1], text: match[2].trim() });
      counter = Math.max(counter, Number(match[1]) + 1);
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      rules.push({ id: String(counter), text: bulletMatch[1].trim() });
      counter += 1;
      continue;
    }

    rules.push({ id: String(counter), text: line });
    counter += 1;
  }

  return rules;
}

export async function loadRulesFromChannel(options: {
  rulesChannel: TextChannel;
  rulesMessageId?: string;
}): Promise<{ rawText: string; parsedRules: ParsedRule[] }>
{
  const { rulesChannel, rulesMessageId } = options;

  let content = "";
  if (rulesMessageId) {
    const message = await rulesChannel.messages.fetch(rulesMessageId);
    content = message.content;
  } else {
    const pinned = await rulesChannel.messages.fetchPinned();
    const pinnedMessage = pinned.first();
    if (pinnedMessage) {
      content = pinnedMessage.content;
    } else {
      const recent = await rulesChannel.messages.fetch({ limit: 20 });
      const candidate = recent.find((message) =>
        message.author.bot || message.member?.permissions.has("ManageGuild")
      );
      content = candidate?.content ?? recent.first()?.content ?? "";
    }
  }

  const parsedRules = parseRules(content);
  return { rawText: content, parsedRules };
}
