import { resolve } from "node:path";
import { Api, TelegramClient } from "teleproto";
import { FloodWaitError } from "teleproto/errors";
import { loadTelegramCooldown, saveTelegramCooldown } from "./cooldown-store.js";

export type UsernameStatus =
  | "AVAILABLE"
  | "OCCUPIED"
  | "PURCHASE_REQUIRED"
  | "NOT_BASIC_LENGTH"
  | "INVALID"
  | "UNKNOWN";

export interface UsernameCheckResult {
  username: string;
  status: UsernameStatus;
  claimable: boolean;
  checkedAt: string;
  detail: string;
}

export interface TelegramCooldownStatus {
  blockedUntil: number;
  waitSeconds: number;
}

export class TelegramFloodWaitError extends Error {
  readonly waitSeconds: number;

  constructor(waitSeconds: number) {
    super("Telegram requested a FLOOD_WAIT of " + waitSeconds + " seconds.");
    this.name = "TelegramFloodWaitError";
    this.waitSeconds = Math.max(1, Math.ceil(waitSeconds));
  }
}

export class TelegramCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramCheckError";
  }
}

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

export function classifyTelegramError(message: string): UsernameStatus | "FLOOD_WAIT" {
  const normalized = message.toUpperCase();

  if (normalized.includes("FLOOD_WAIT")) return "FLOOD_WAIT";
  if (normalized.includes("USERNAME_PURCHASE_AVAILABLE")) return "PURCHASE_REQUIRED";
  if (normalized.includes("USERNAME_OCCUPIED")) return "OCCUPIED";
  if (normalized.includes("USERNAME_INVALID")) return "INVALID";

  return "UNKNOWN";
}

function getErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { errorMessage?: unknown; message?: unknown };
    if (typeof record.errorMessage === "string") return record.errorMessage;
    if (typeof record.message === "string") return record.message;
  }
  return String(error);
}

function getFloodWaitSeconds(error: unknown, message: string): number {
  if (error && typeof error === "object") {
    const seconds = (error as { seconds?: unknown }).seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return Math.max(1, Math.ceil(seconds));
    }
  }

  const match = message.match(/FLOOD_WAIT_([0-9]+)/i)
    ?? message.match(/wait of ([0-9]+) seconds/i);
  return match ? Math.max(1, Number(match[1])) : 60;
}

function createLocalResult(
  username: string,
  status: "INVALID" | "NOT_BASIC_LENGTH",
  detail: string
): UsernameCheckResult {
  return {
    username,
    status,
    claimable: false,
    checkedAt: new Date().toISOString(),
    detail
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

/**
 * Serializes all MTProto username checks and applies one shared request interval.
 * Deep search, manual /check and the release monitor all use this same queue.
 * Telegram FLOOD_WAIT is persisted so restarting the bot cannot accidentally
 * turn the server's cooldown into another immediate request.
 */
export class TelegramUsernameChecker {
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  private blockedUntil = 0;
  private readonly cooldownLoaded: Promise<void>;

  constructor(
    private readonly client: TelegramClient,
    private readonly minimumIntervalMs = 1_500,
    private readonly cooldownPath = resolve(process.cwd(), "data/telegram-cooldown.json")
  ) {
    this.cooldownLoaded = loadTelegramCooldown(this.cooldownPath).then((until) => {
      this.blockedUntil = until;
    });
  }

  async getCooldownStatus(): Promise<TelegramCooldownStatus> {
    await this.cooldownLoaded;
    const waitSeconds = Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1_000));
    return { blockedUntil: this.blockedUntil, waitSeconds };
  }

  check(input: string): Promise<UsernameCheckResult> {
    const username = normalizeUsername(input);

    if (!/^[a-z][a-z0-9_]{3,31}$/.test(username)) {
      return Promise.resolve(createLocalResult(
        username,
        "INVALID",
        "Telegram Basic usernames must start with a letter and contain 5–32 letters, digits or underscores."
      ));
    }

    // account.checkUsername only accepts 5–32 characters. Four-character names
    // cannot be confirmed as free Basic usernames through this method.
    if (username.length === 4) {
      return Promise.resolve(createLocalResult(
        username,
        "NOT_BASIC_LENGTH",
        "Four characters are below Telegram's 5-character Basic username minimum. This result does not verify a collectible or its ownership."
      ));
    }

    const operation = this.queue.then(async () => {
      await this.cooldownLoaded;
      return this.checkOnTelegram(username);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async activateFloodWait(waitSeconds: number): Promise<TelegramFloodWaitError> {
    const until = Math.max(this.blockedUntil, Date.now() + waitSeconds * 1_000);
    this.blockedUntil = until;

    try {
      await saveTelegramCooldown(until, this.cooldownPath);
    } catch (error) {
      console.error("Could not persist Telegram FLOOD_WAIT:", error);
    }

    return new TelegramFloodWaitError(Math.ceil((until - Date.now()) / 1_000));
  }

  private async checkOnTelegram(username: string): Promise<UsernameCheckResult> {
    const now = Date.now();

    if (now < this.blockedUntil) {
      throw new TelegramFloodWaitError(Math.ceil((this.blockedUntil - now) / 1_000));
    }

    const waitMs = this.nextRequestAt - now;
    if (waitMs > 0) await delay(waitMs);

    const beforeRequest = Date.now();
    if (beforeRequest < this.blockedUntil) {
      throw new TelegramFloodWaitError(Math.ceil((this.blockedUntil - beforeRequest) / 1_000));
    }

    this.nextRequestAt = Date.now() + Math.max(0, this.minimumIntervalMs);
    const checkedAt = new Date().toISOString();

    try {
      const available = await this.client.invoke(
        new Api.account.CheckUsername({ username })
      );

      if (available === true) {
        return {
          username,
          status: "AVAILABLE",
          claimable: true,
          checkedAt,
          detail: "Telegram confirmed this Basic username is available at the time of this check. It is not reserved."
        };
      }

      if (available === false) {
        return {
          username,
          status: "OCCUPIED",
          claimable: false,
          checkedAt,
          detail: "Telegram returned false for account.checkUsername; it is not available as a free Basic username."
        };
      }

      throw new TelegramCheckError(
        "Telegram returned a non-boolean result for account.checkUsername. The username is not treated as available."
      );
    } catch (error) {
      if (error instanceof TelegramFloodWaitError || error instanceof TelegramCheckError) {
        throw error;
      }

      if (error instanceof FloodWaitError) {
        const waitSeconds = getFloodWaitSeconds(error, getErrorText(error));
        throw await this.activateFloodWait(waitSeconds);
      }

      const message = getErrorText(error);
      const classification = classifyTelegramError(message);

      if (classification === "FLOOD_WAIT") {
        const waitSeconds = getFloodWaitSeconds(error, message);
        throw await this.activateFloodWait(waitSeconds);
      }

      if (classification === "OCCUPIED") {
        return {
          username,
          status: "OCCUPIED",
          claimable: false,
          checkedAt,
          detail: "Telegram reports that this username is already occupied."
        };
      }

      if (classification === "PURCHASE_REQUIRED") {
        return {
          username,
          status: "PURCHASE_REQUIRED",
          claimable: false,
          checkedAt,
          detail: "Telegram reports that this username can be purchased through Fragment. It is not free; this is not a market price or listing check."
        };
      }

      if (classification === "INVALID") {
        return {
          username,
          status: "INVALID",
          claimable: false,
          checkedAt,
          detail: "Telegram rejected this username as invalid or reserved. It is not available as a free Basic username."
        };
      }

      // Network, authorization, server and unrecognized RPC errors must stop a
      // scan. They are not ordinary candidate results.
      throw new TelegramCheckError(
        "Telegram availability check failed for @" + username + ": " + message.slice(0, 240)
      );
    }
  }
}
