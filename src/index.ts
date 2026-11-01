import { TelegramUsernameChecker } from "./telegram/checker.js";
import { createAuthorizedTelegramClient } from "./telegram/client.js";
import { createBot, startBot } from "./bot.js";

async function main(): Promise<void> {
  const client = await createAuthorizedTelegramClient();
  const checker = new TelegramUsernameChecker(client);
  const bot = createBot(checker);

  const shutdown = async (signal: string) => {
    console.log("Received " + signal + ", shutting down.");
    await bot.stop();
    await client.disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await startBot(bot);
}

main().catch((error: unknown) => {
  console.error("UserFind startup failed:", error);
  process.exitCode = 1;
});