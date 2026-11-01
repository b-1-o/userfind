import { describe, expect, it, vi } from "vitest";
import { TelegramClient } from "teleproto";
import {
  classifyTelegramError,
  normalizeUsername,
  TelegramCheckError,
  TelegramFloodWaitError,
  TelegramUsernameChecker
} from "../src/telegram/checker.js";

function makeChecker(invoke: ReturnType<typeof vi.fn>) {
  const client = { invoke } as unknown as TelegramClient;
  return new TelegramUsernameChecker(client, 0);
}

describe("Telegram checker helpers", () => {
  it("normalizes @ prefixes and case", () => {
    expect(normalizeUsername("  @Lumen  ")).toBe("lumen");
  });

  it("classifies Fragment purchase-required errors", () => {
    expect(classifyTelegramError("USERNAME_PURCHASE_AVAILABLE")).toBe("PURCHASE_REQUIRED");
  });

  it("recognizes occupied, invalid and flood-wait errors", () => {
    expect(classifyTelegramError("USERNAME_OCCUPIED")).toBe("OCCUPIED");
    expect(classifyTelegramError("USERNAME_INVALID")).toBe("INVALID");
    expect(classifyTelegramError("FLOOD_WAIT_120")).toBe("FLOOD_WAIT");
  });
});

describe("TelegramUsernameChecker.check", () => {
  it("returns AVAILABLE only when Telegram returns true", async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const checker = makeChecker(invoke);

    const result = await checker.check("@Lumen");

    expect(result.username).toBe("lumen");
    expect(result.status).toBe("AVAILABLE");
    expect(result.claimable).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("returns OCCUPIED when Telegram returns false", async () => {
    const invoke = vi.fn().mockResolvedValue(false);
    const checker = makeChecker(invoke);

    const result = await checker.check("lumen");

    expect(result.status).toBe("OCCUPIED");
    expect(result.claimable).toBe(false);
  });

  it("distinguishes Fragment purchase-required usernames", async () => {
    const invoke = vi.fn().mockRejectedValue({ errorMessage: "USERNAME_PURCHASE_AVAILABLE" });
    const checker = makeChecker(invoke);

    const result = await checker.check("lumen");

    expect(result.status).toBe("PURCHASE_REQUIRED");
    expect(result.claimable).toBe(false);
    expect(result.detail).toContain("Fragment");
  });

  it("does not call Telegram for four-character names", async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const checker = makeChecker(invoke);

    const result = await checker.check("aura");

    expect(result.status).toBe("NOT_BASIC_LENGTH");
    expect(result.claimable).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed on unrecognized Telegram or network errors", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("NETWORK_TIMEOUT"));
    const checker = makeChecker(invoke);

    await expect(checker.check("lumen")).rejects.toBeInstanceOf(TelegramCheckError);
  });

  it("parses flood-wait seconds and blocks queued calls", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("FLOOD_WAIT_127"));
    const checker = makeChecker(invoke);

    await expect(checker.check("lumen")).rejects.toMatchObject({
      waitSeconds: 127
    });
    await expect(checker.check("velvet")).rejects.toBeInstanceOf(TelegramFloodWaitError);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent calls through one request queue", async () => {
    let active = 0;
    let maximumActive = 0;
    const invoke = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return true;
    });
    const checker = makeChecker(invoke);

    await Promise.all([
      checker.check("lumen"),
      checker.check("velvet"),
      checker.check("coral")
    ]);

    expect(maximumActive).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});