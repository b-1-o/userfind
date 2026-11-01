import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { config, requireTelegramCredentials, requireTelegramSession } from "../config.js";

export async function createAuthorizedTelegramClient(): Promise<TelegramClient> {
  const credentials = requireTelegramCredentials();
  const session = requireTelegramSession();

  const client = new TelegramClient(
    new StringSession(session),
    credentials.apiId,
    credentials.apiHash,
    {
      connectionRetries: 5,
      autoReconnect: true,
      requestRetries: 2
    }
  );

  await client.connect();

  const authorized = await client.checkAuthorization();
  if (!authorized) {
    await client.disconnect();
    throw new Error("The saved Telegram session is not authorized. Run npm run auth again.");
  }

  if (!config.allowedUserIds.size) {
    console.warn("BOT_ALLOWED_USER_IDS is empty. Search/check commands will be locked until an owner ID is configured.");
  }

  return client;
}