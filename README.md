# UserFind

Quality-first Telegram username discovery.

UserFind generates meaningful words, brandable candidates and visual variants, ranks them locally, then asks Telegram whether each candidate is available as a free Basic username. A name is shown as **FREE** only when Telegram confirms it.

## Telegram rules that shape the checker

- Telegram's official Basic username checker accepts 5–32 characters.
- Four-character Telegram usernames are collectible-only and cannot be claimed as free Basic usernames.
- Telegram error USERNAME_PURCHASE_AVAILABLE means the username can be purchased on Fragment. It is **not free**.
- A successful check is a point-in-time result, not a reservation.
- Inactivity is not evidence that a username is abandoned or reclaimable. Only Telegram's live availability response can make it a free result.

Official references:
- https://core.telegram.org/method/account.checkUsername
- https://core.telegram.org/api/fragment

## Stack

- Node.js 22 + TypeScript
- grammY for the bot interface
- GramJS for the authorized MTProto read-only checker
- Zod + dotenv for configuration
- Vitest + GitHub Actions for tests and CI
- Atomic JSON history file for the first version

## What is implemented

- Curated English word candidates.
- Brandable combinations and pronounceable constructions.
- One-letter visual alternatives, including lowercase l -> i.
- Quality scoring for lexical quality, pronunciation, visual simplicity, length rarity and brandability.
- Sequential Telegram checks with configurable delay.
- Explicit handling for occupied, purchase-required, invalid, collectible-only and unknown results.
- Flood-wait handling: a scan stops instead of trying to bypass Telegram's limit.
- A Telegram bot with /find, /check, /id and /help.
- Owner-only access to checks and scans.
- Local search history.

The current quality score is a discovery heuristic, not a market-price estimate. Verified sales-data ingestion and comparable-sale valuation are a separate next milestone; the bot does not invent a price or call an attractive name an investment.

## Requirements

- Node.js 22.12 or newer
- Telegram bot token from @BotFather
- Telegram API ID and API hash from https://my.telegram.org
- A private MTProto session for the checker account

## Setup

1. Clone the repository and install dependencies:

   npm install

2. Copy .env.example to .env.

3. Add BOT_TOKEN, TG_API_ID and TG_API_HASH.

4. Create the MTProto session:

   npm run auth

   The script prints a TG_SESSION value. Paste it into your local .env only. Do not send it to anyone and do not commit it.

5. Start the bot:

   npm run dev

6. Send /id to your bot. Copy the numeric ID into BOT_ALLOWED_USER_IDS in .env, restart the bot, then use /find.

## Commands

- /start — introduction
- /find — default deep search for lengths 5–8, up to 10 minutes
- /find 5-7 20 — search lengths 5–7 and return up to 20 results
- /check username — check one candidate
- /id — show your Telegram numeric user ID
- /help — command reference

## Search behavior

Candidates are ranked before any Telegram requests. Checks run one at a time with a conservative interval. If Telegram returns FLOOD_WAIT, the scan stops and reports the requested wait period. Do not reduce the delay to try to bypass restrictions.

The 4-character category is intentionally not presented as free availability: it requires a collectible username and is outside this free-claim scanner. If a 5–32 character name returns USERNAME_PURCHASE_AVAILABLE, UserFind labels it purchase-required and excludes it from free results.

Visual mutation uses lowercase l -> i. Uppercase I is not a separate variant because Telegram usernames are case-insensitive. Digit substitutions are not enabled by default because they often reduce readability and quality.

## Security

- Never commit .env, TG_SESSION, bot tokens or API hashes.
- Keep BOT_ALLOWED_USER_IDS restricted to your own numeric Telegram ID.
- The checker only calls account.checkUsername. It does not assign names, change account settings, or take control of another account.
- Do not share the MTProto session string. Anyone who gets it may gain access to the Telegram account that created it.
- Use the checker account only for this read-only purpose.

## Current limitations

- A successful availability check can become stale immediately; Telegram does not reserve a username during search.
- An inactive-looking account cannot be reclaimed by this tool.
- The initial word list and constructed-name library are deliberately curated and finite. Expand them with properly licensed dictionaries and reviewed word lists.
- Market value is not yet computed. The quality score is not a price forecast.
