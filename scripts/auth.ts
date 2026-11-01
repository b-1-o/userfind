import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { requireTelegramCredentials } from "../src/config.js";

async function main(): Promise<void> {
  const { apiId, apiHash } = requireTelegramCredentials();
  const terminal = createInterface({ input: stdin, output: stdout });
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5
  });

  try {
    console.log("This creates a checker session. Never share the resulting session string.");
    await client.start({
      phoneNumber: async () => terminal.question("Telegram phone number (with country code): "),
      phoneCode: async () => terminal.question("Login code from Telegram: "),
      password: async () => terminal.question("Two-step verification password (if enabled): "),
      onError: (error) => console.error("Telegram authorization error:", error)
    });

    console.log("\nAuthorization successful.");
    console.log("Add this line to your private .env file:\n");
    console.log("TG_SESSION=" + client.session.save());
    console.log("\nDo not paste this value into GitHub, a chat, or a public issue.");
  } finally {
    terminal.close();
    await client.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Session setup failed:", error);
  process.exitCode = 1;
});