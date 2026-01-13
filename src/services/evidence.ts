import type { Guild, TextChannel, Message } from "discord.js";

export interface EvidenceMessage {
  content: string;
  authorTag: string;
  timestamp: string;
  channelName: string;
  channelId: string;
  jumpLink: string | null;
}

export interface EvidenceResult {
  messages: EvidenceMessage[];
  summary: string;
  caseFile: string;
}

function formatMessage(message: Message): EvidenceMessage {
  return {
    content: message.content || "[no text content]",
    authorTag: `${message.author.tag}`,
    timestamp: message.createdAt.toISOString(),
    channelName: message.channel.isDMBased() ? "DM" : (message.channel as TextChannel).name,
    channelId: message.channel.id,
    jumpLink: message.url ?? null,
  };
}

export async function collectEvidence(options: {
  guild: Guild;
  suspectId: string;
  maxMessagesPerChannel: number;
  maxDays: number;
}): Promise<EvidenceResult> {
  const { guild, suspectId, maxMessagesPerChannel, maxDays } = options;
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  const messages: EvidenceMessage[] = [];

  const me = guild.members.me;
  const channels = guild.channels.cache
    .filter((channel) => {
      if (!channel.isTextBased()) {
        return false;
      }
      if (!me) {
        return false;
      }
      const permissions = channel.permissionsFor(me);
      return permissions?.has("ViewChannel") ?? false;
    })
    .map((channel) => channel as TextChannel);

  for (const channel of channels.values()) {
    let lastId: string | undefined;
    let fetched = 0;

    while (fetched < maxMessagesPerChannel) {
      const remaining = maxMessagesPerChannel - fetched;
      const batch = await channel.messages.fetch({
        limit: Math.min(100, remaining),
        before: lastId,
      });

      if (batch.size === 0) {
        break;
      }

      for (const message of batch.values()) {
        if (message.author.id !== suspectId) {
          continue;
        }
        if (message.createdTimestamp < cutoff) {
          continue;
        }
        messages.push(formatMessage(message));
      }

      fetched += batch.size;
      lastId = batch.last()?.id;
      if (!lastId) {
        break;
      }
    }
  }

  messages.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));

  const summary = messages.length
    ? `Collected ${messages.length} message(s) from the suspect within ${maxDays} day(s).`
    : "No evidence found within the configured scope.";

  const caseFile = messages
    .map(
      (msg, index) =>
        `#${index + 1}\n` +
        `Author: ${msg.authorTag}\n` +
        `Timestamp: ${msg.timestamp}\n` +
        `Channel: #${msg.channelName} (${msg.channelId})\n` +
        `Message: ${msg.content}\n` +
        (msg.jumpLink ? `Link: ${msg.jumpLink}` : "Link: unavailable")
    )
    .join("\n\n");

  return { messages, summary, caseFile };
}

export function truncateForDisplay(text: string, maxLength = 1800): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n\n...[truncated]`;
}
