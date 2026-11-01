import type { Bot } from "grammy";
import { config } from "../config.js";
import {
  markWatchedChecked,
  readWatchlist,
  removeWatchedUsername
} from "../storage/watch-store.js";
import {
  TelegramFloodWaitError,
  TelegramUsernameChecker
} from "../telegram/checker.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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

  const runCycle = async (): Promise<void> => {
    if (running) return;
    running = true;

    try {
      const entries = await readWatchlist();
      for (const entry of entries) {
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
            result.status === "COLLECTIBLE_ONLY"
          ) {
            // It cannot be claimed as a free Basic username.
            await removeWatchedUsername(entry.username);
          }
        } catch (error) {
          if (error instanceof TelegramFloodWaitError) {
            console.warn("Release monitor paused by Telegram FLOOD_WAIT:", error.waitSeconds);
            break;
          }
          console.error("Release monitor check failed for @" + entry.username + ":", error);
        }

        await sleep(config.checkIntervalMs);
      }
    } catch (error) {
      console.error("Release monitor cycle failed:", error);
    } finally {
      running = false;
    }
  };

  const initialTimer = setTimeout(() => void runCycle(), 60_000);
  const intervalTimer = setInterval(() => void runCycle(), config.watchIntervalMs);
  initialTimer.unref();
  intervalTimer.unref();

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}