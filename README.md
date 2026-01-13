# AI Judge Bot (Discord)

Courtroom-style moderation workflow for Discord. The bot isolates a suspect in `#courtroom`, collects evidence, reads server rules, runs an AI Lawyer + AI Judge debate, and then produces a verdict. **Kick/ban always requires a human moderator confirmation.**

## Features

- **Courtroom isolation** via a temporary `IN_COURT` role and channel permission overwrites.
- **Evidence collection** from recent messages (configurable messages per channel + days).
- **Rules parsing** from `#rules` with support for pinned or specific messages.
- **AI Lawyer & Judge** outputs in structured JSON.
- **Moderator confirmation** for punishments (no auto kick/ban).
- **Mod-log integration** with case ID tracking.

## Setup

### 1) Create the bot in Discord Developer Portal

- Create a new application and add a bot.
- Enable **Server Members Intent** and **Message Content Intent**.
- Copy the bot token.

### 2) Create channels + role

Create the following channels in your guild:

- `#courtroom`
- `#rules`
- `#mod-log`

Create a role named `IN_COURT` (or a custom name you set in `.env`). The bot will apply permission overwrites:

- **Deny** `ViewChannel` everywhere for the role.
- **Allow** `ViewChannel`, `SendMessages`, `ReadMessageHistory` in `#courtroom`.

### 3) Invite the bot

Use OAuth scopes:

- `bot`
- `applications.commands`

Required permissions:

- Read Messages / View Channels
- Send Messages
- Manage Roles
- Manage Channels (for overwrites)
- Kick Members / Ban Members (only used after manual confirmation)
- Moderate Members (timeout)

### 4) Configure environment

Create `.env`:

```
DISCORD_TOKEN=your_token
OPENAI_API_KEY=your_openai_key
COURTROOM_CHANNEL_ID=123
RULES_CHANNEL_ID=456
MODLOG_CHANNEL_ID=789
IN_COURT_ROLE_NAME=IN_COURT
EVIDENCE_MAX_MESSAGES_PER_CHANNEL=50
EVIDENCE_MAX_DAYS=7
MODEL_NAME=gpt-4o-mini
# Optional
GUILD_ID=optional_guild_for_dev
RULES_MESSAGE_ID=optional_rules_message
```

### 5) Install + run

```
npm install
npm run build
npm start
```

## Slash Commands

- `/trial start user:@user reason:(optional)`
- `/trial evidence`
- `/trial defense`
- `/trial verdict`
- `/trial confirm action:(kick|ban|timeout|warning|none) duration:(for timeout)`
- `/trial end`

## Notes

- Evidence is stored only in memory and posted to `#mod-log`. No database is used by default.
- If AI confidence is low, the Judge is instructed to choose lighter actions.

## Tests

```
npm run build
npm test
```
