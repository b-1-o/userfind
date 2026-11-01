import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
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
      requestRetries: 2,
      floodSleepThreshold: 0
    }
  );

  await client.connect();

  try {
    // A saved session is valid only if an authenticated account call succeeds.
    await client.getMe();
  } catch (error) {
    await client.disconnect();
    throw new Error(
      "The saved Telegram session is not authorized or has expired. Run npm run auth again. " +
      (error instanceof Error ? error.message : String(error))
    );
  }


  if (!config.allowedUserIds.size) {
    console.warn("BOT_ALLOWED_USER_IDS is empty. Search/check commands will be locked until an owner ID is configured.");
  }

  return client;
}