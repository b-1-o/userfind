import { Api, TelegramClient } from "telegram";

export type UsernameStatus =
  | "AVAILABLE"
  | "OCCUPIED"
  | "PURCHASE_REQUIRED"
  | "COLLECTIBLE_ONLY"
  | "INVALID"
  | "UNKNOWN";

export interface UsernameCheckResult {
  username: string;
  status: UsernameStatus;
  claimable: boolean;
  checkedAt: string;
  detail: string;
}

export class TelegramFloodWaitError extends Error {
  readonly waitSeconds: number;

  constructor(waitSeconds: number) {
    super("Telegram requested a FLOOD_WAIT of " + waitSeconds + " seconds.");
    this.name = "TelegramFloodWaitError";
    this.waitSeconds = waitSeconds;
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
    if (typeof seconds === "number" && Number.isFinite(seconds)) return Math.max(1, seconds);
  }

  const match = message.match(/FLOOD_WAIT_([0-9]+)/i) ?? message.match(/wait of ([0-9]+) seconds/i);
  return match ? Math.max(1, Number(match[1])) : 60;
}

export class TelegramUsernameChecker {
  constructor(private readonly client: TelegramClient) {}

  async check(input: string): Promise<UsernameCheckResult> {
    const username = normalizeUsername(input);
    const checkedAt = new Date().toISOString();

    if (!/^[a-z][a-z0-9_]{3,31}$/.test(username)) {
      return {
        username,
        status: "INVALID",
        claimable: false,
        checkedAt,
        detail: "Telegram usernames must start with a letter and contain 5–32 letters, digits or underscores."
      };
    }

    // Basic usernames are 5–32 characters. Four-character names are collectible-only.
    if (username.length === 4) {
      return {
        username,
        status: "COLLECTIBLE_ONLY",
        claimable: false,
        checkedAt,
        detail: "Four-character Telegram usernames are collectible-only and cannot be claimed as free Basic usernames."
      };
    }

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
          detail: "Telegram confirmed this Basic username is available at the time of this check."
        };
      }

      if (available === false) {
        return {
          username,
          status: "OCCUPIED",
          claimable: false,
          checkedAt,
          detail: "Telegram returned false for account.checkUsername."
        };
      }

      return {
        username,
        status: "UNKNOWN",
        claimable: false,
        checkedAt,
        detail: "Telegram returned an unrecognized response. This is not treated as available."
      };
    } catch (error) {
      const message = getErrorText(error);
      const classification = classifyTelegramError(message);

      if (classification === "FLOOD_WAIT") {
        throw new TelegramFloodWaitError(getFloodWaitSeconds(error, message));
      }

      const detailByStatus: Record<Exclude<UsernameStatus, "AVAILABLE" | "COLLECTIBLE_ONLY">, string> = {
        OCCUPIED: "Telegram reports that this username is already occupied.",
        PURCHASE_REQUIRED: "Telegram reports that this username can be purchased on Fragment. It is not free to claim.",
        INVALID: "Telegram rejected this username as invalid.",
        UNKNOWN: "Telegram did not provide a recognized availability result: " + message.slice(0, 180)
      };

      const status = classification;
      return {
        username,
        status,
        claimable: false,
        checkedAt,
        detail: detailByStatus[status as keyof typeof detailByStatus]
      };
    }
  }
}