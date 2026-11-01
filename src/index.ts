import { TelegramUsernameChecker } from "./telegram/checker.js";
import { createAuthorizedTelegramClient } from "./telegram/client.js";
import { createBot, startBot } from "./bot.js";
import { startReleaseMonitor } from "./monitor/release-monitor.js";
import { config, requireBotToken } from "./config.js";

async function main(): Promise<void> {
  // Validate the Bot API credential before opening an MTProto account session.
  requireBotToken();

  const client = await createAuthorizedTelegramClient();
  let stopReleaseMonitor: () => void = () => {};

  try {
    // The same checker instance shares one serial rate limiter between manual
    // checks, deep searches and the background release monitor.
    const checker = new TelegramUsernameChecker(client, config.checkIntervalMs);
    const bot = createBot(checker);
    stopReleaseMonitor = startReleaseMonitor(bot, checker);

    await startBot(bot);
  } finally {
    stopReleaseMonitor();
    await client.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("UserFind startup failed:", error);
  process.exitCode = 1;
});