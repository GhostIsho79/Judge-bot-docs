import type {
  Guild,
  GuildMember,
  Role,
  TextChannel,
  PermissionResolvable,
} from "discord.js";

const REQUIRED_ROLE_PERMISSIONS: PermissionResolvable[] = [];

export async function ensureCourtRole(options: {
  guild: Guild;
  roleName: string;
}): Promise<Role> {
  const { guild, roleName } = options;
  const existing = guild.roles.cache.find((role) => role.name === roleName);
  if (existing) {
    return existing;
  }

  return guild.roles.create({
    name: roleName,
    permissions: REQUIRED_ROLE_PERMISSIONS,
    mentionable: false,
    reason: "Courtroom isolation role for trial process",
  });
}

export async function applyCourtroomIsolation(options: {
  guild: Guild;
  suspect: GuildMember;
  role: Role;
  courtroomChannel: TextChannel;
}): Promise<void> {
  const { guild, suspect, role, courtroomChannel } = options;

  const channels = guild.channels.cache.filter((channel) => channel.isTextBased());
  for (const channel of channels.values()) {
    await channel.permissionOverwrites.edit(role, {
      ViewChannel: false,
    });
  }

  await courtroomChannel.permissionOverwrites.edit(role, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });

  if (!suspect.roles.cache.has(role.id)) {
    await suspect.roles.add(role, "Trial started: courtroom isolation");
  }
}

export async function removeCourtroomIsolation(options: {
  suspect: GuildMember;
  role: Role;
}): Promise<void> {
  const { suspect, role } = options;
  if (suspect.roles.cache.has(role.id)) {
    await suspect.roles.remove(role, "Trial ended: restore access");
  }
}
