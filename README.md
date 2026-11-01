# UserFind

**Quality-first Telegram username discovery.**

UserFind ranks meaningful, memorable, visually clean username candidates, then checks each candidate against Telegram through an authorized MTProto user session. It only reports a name as **free to claim** when Telegram's account.checkUsername method explicitly confirms availability.

## Important Telegram rules

- Basic usernames are 5–32 characters and accept Latin letters, digits and underscores.
- Four-character usernames are collectible-only; they cannot be claimed as ordinary free usernames.
- USERNAME_PURCHASE_AVAILABLE means the username is purchasable on Fragment, not freely claimable.
- A successful check is a point-in-time result, not a reservation. Another person may claim the name immediately.
- Inactive-looking accounts are not proof that a username is abandoned or reclaimable. UserFind never tries to take over accounts, bypass Telegram restrictions, or infer availability from inactivity.

Official references:
- https://core.telegram.org/method/account.checkUsername
- https://core.telegram.org/api/fragment

## Current implementation

This repository is being bootstrapped with:
- TypeScript + Node.js
- grammY Telegram bot interface
- GramJS MTProto read-only availability checks
- Candidate discovery from curated words, brandable fragments and visual mutations (l -> i)
- Quality-first ranking
- Serial checks with conservative pacing and FLOOD_WAIT handling
- Local JSON result history (no database service required for the first version)

## Setup

Requirements: Node.js 22+, a Telegram bot token, and Telegram API credentials for an authorized user session.

1. Install dependencies: npm install
2. Copy .env.example to .env and fill in the credentials.
3. Create an MTProto session: npm run auth
4. Start the bot: npm run dev

## Commands

- /start — introduction
- /find — deep search (defaults to 5–8 characters, up to 10 minutes)
- /find 5-7 15 — search lengths 5–7 and return up to 15 results
- /check username — check one username
- /help — usage

Only real Telegram-confirmed free-to-claim names appear in the available-results section. Collectible purchase-required names and unknown results are never counted as free.

## Security

- Never commit .env, MTProto session strings, bot tokens or API hashes.
- Use a separate Telegram account for the read-only checker if appropriate.
- The MTProto checker only calls account.checkUsername; it does not change account settings or assign usernames.
- Keep the bot and checker session private. A leaked MTProto session can grant access to a Telegram account.