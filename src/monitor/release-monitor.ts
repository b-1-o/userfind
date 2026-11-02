import type { Bot } from "grammy";
import { config } from "../config.js";
import { isSearchActive } from "../search/activity.js";
import {
  markWatchedChecked,
  readWatchlist,
  removeWatchedUsername
} from "../storage/watch-store.js";
import {
  TelegramCheckError,
  TelegramFloodWaitError,
  TelegramUsernameChecker
} from "../telegram/checker.js";

export function startReleaseMonitor(
  bot: Bot,
  checker: TelegramUsernameChecker
): () => void {
  const ownerIds = [...config.allowedUserIds];
  if (!ownerIds.length) {
    console.warn("Release monitor disabled: BOT_ALLOWED_USER_IDS is empty.");
    return () => undefined;
  }

  let running = false;
  let stopped = false;

  const runCycle = async (): Promise<void> => {
    // Never compete with a foreground search for the same account's MTProto quota.
    if (running || stopped || isSearchActive()) return;
    running = true;

    try {
      const entries = await readWatchlist();
      for (const entry of entries) {
        if (stopped || isSearchActive()) break;

        try {
          const result = await checker.check(entry.username);
          await markWatchedChecked(entry.username);

          if (result.status === "AVAILABLE" && result.claimable) {
            const message = [
              "A watched Telegram username is now FREE.",
              "",
              "@" + entry.username,
              "Quality score: " + entry.score + "/100",
              "Telegram confirmed availability at: " + result.checkedAt,
              "",
              "This is not a reservation. Open Telegram and try to claim it immediately: https://t.me/" + entry.username
            ].join("\n");

            let notified = false;
            for (const ownerId of ownerIds) {
              try {
                await bot.api.sendMessage(ownerId, message);
                notified = true;
              } catch (error) {
                console.error("Could not notify owner about @" + entry.username + ":", error);
              }
            }

            if (notified) {
              await removeWatchedUsername(entry.username);
            }
          } else if (
            result.status === "PURCHASE_REQUIRED" ||
            result.status === "INVALID" ||
            result.status === "NOT_BASIC_LENGTH"
          ) {
            await removeWatchedUsername(entry.username);
          }
        } catch (error) {
          console.error("Release monitor stopped for this cycle:", error);
          if (error instanceof TelegramFloodWaitError || error instanceof TelegramCheckError) {
            break;
          }
          // A transient transport/runtime error is also a reason to stop the
          // cycle rather than issue many repeated failing requests.
          break;
        }
      }
    } catch (error) {
      console.error("Release monitor cycle failed:", error);
    } finally {
      running = false;
    }
  };

  // Do not run a large 150-name cycle one minute after startup: that used to
  // consume the same MTProto queue while the owner was doing a manual search.
  const initialTimer = setTimeout(() => void runCycle(), config.watchIntervalMs);
  const intervalTimer = setInterval(() => void runCycle(), config.watchIntervalMs);
  initialTimer.unref();
  intervalTimer.unref();

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
