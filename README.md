# UserFind

Quality-first Telegram username discovery. The target is a free Basic username that Telegram confirms can be claimed now, not merely a pretty or inactive-looking account name.

UserFind generates meaningful words, brandable candidates and visual variants, ranks them locally, then verifies each candidate with Telegram's MTProto method account.checkUsername. A name is shown as **FREE BASIC** only when Telegram returns true.

## Telegram availability rules

- Telegram's official account.checkUsername accepts 5–32 characters.
- A four-character name is outside the Basic username range. UserFind does not call it free and does not claim to verify its Fragment NFT listing.
- USERNAME_PURCHASE_AVAILABLE is Telegram's signal that the name can be purchased through Fragment. It is **not free** and is excluded from free results.
- USERNAME_OCCUPIED and a false API result are never counted as free.
- A successful check is a point-in-time result, not a reservation. Another person can claim the name immediately.
- An inactive-looking account is not proof that a username is abandoned or reclaimable.

Official references:
- https://core.telegram.org/method/account.checkUsername
- https://core.telegram.org/api/fragment

## Stack

- Node.js 22 + TypeScript
- grammY for the bot interface
- teleproto for authorized MTProto checks
- Zod + dotenv for configuration
- Vitest + GitHub Actions for typechecking, production build, tests and dependency audit
- Atomic local JSON files for search history and release watchlist

## Implemented

- Curated English word candidates.
- Brandable combinations and pronounceable constructions.
- Visual variants, including lowercase l -> i.
- Quality heuristic for lexical quality, pronunciation, visual simplicity, length and brandability.
- One shared serialized MTProto request queue and configurable minimum delay, used by manual checks, deep searches and the release monitor.
- Explicit handling for free, occupied, purchase-required, invalid and out-of-Basic-range names.
- Flood-wait circuit breaker: Telegram rate limits stop further checks instead of triggering repeated requests.
- Unexpected Telegram/network errors stop the current scan rather than silently turning into an ordinary unknown candidate.
- Owner-only commands, limited to the configured owner's private chat.
- /cancel to stop a running scan after its in-flight Telegram request finishes.
- Chunked Telegram replies so a large result list does not exceed one-message limits.
- Release watch: the best occupied candidates from searches are retained and rechecked every six hours by default. If Telegram later confirms one is free, UserFind notifies the owner.

The release watch does not inspect private account activity or label accounts as abandoned. It only observes Telegram's live availability response.

The current quality score is a discovery heuristic, not a market-price estimate. UserFind does not invent prices or represent the score as investment value.

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

   The script prints a TG_SESSION value. Paste it into your local .env only. Never send it to anyone and never commit it.

5. Start the bot:

   npm run dev

6. Send /id to the bot. Copy the numeric ID into BOT_ALLOWED_USER_IDS in .env, restart the bot, then use /find.

## Commands

- /start — introduction
- /find — search lengths 5–8, up to 10 minutes
- /find 5-7 20 — search lengths 5–7 and return up to 20 results
- /check username — check one candidate
- /cancel — cancel the active deep search
- /watchlist — view the best occupied names being monitored
- /unwatch username — stop monitoring a name
- /id — show your Telegram numeric user ID
- /help — command reference

A command with a minimum length of 4 may be used to see that category skipped, but a 4-character name cannot be confirmed as a free Basic username. Use 5+ for the free-claim search.

## Configuration

See .env.example. Important settings:

- CHECK_INTERVAL_MS: minimum delay between all MTProto checks; default 1500.
- SEARCH_DURATION_MS: maximum duration of a deep search; default 600000 (10 minutes).
- MAX_CANDIDATES: maximum locally ranked candidate pool; default 6000.
- WATCH_INTERVAL_MS: release-watch cycle interval; default 21600000 (6 hours).
- WATCH_MAX_ENTRIES: maximum occupied names retained; default 150.

## Security

- Never commit .env, TG_SESSION, bot tokens or API hashes.
- Keep BOT_ALLOWED_USER_IDS restricted to your own numeric Telegram ID.
- The checker only calls account.checkUsername. It does not assign names, change account settings, or take control of another account.
- A StringSession is a long-lived account credential. Anyone holding it may access the associated Telegram account. Treat it like a password.
- Use the checker account only for this read-only purpose.

## Limitations

- Telegram's availability check does not reserve a username; the status can change immediately after the response.
- UserFind does not directly query Fragment's current listing, auction price or ownership history. It only uses Telegram's USERNAME_PURCHASE_AVAILABLE response to exclude usernames that are purchase-required.
- Four-character names are outside the Basic check. Their collectible listing/ownership status is not verified by this scanner.
- The word list and constructed-name library are finite and need broader reviewed lexical data.
- Market valuation based on verified comparable collectible sales is not implemented.
