import { describe, expect, it } from "vitest";
import { classifyTelegramError, normalizeUsername } from "../src/telegram/checker.js";

describe("Telegram checker helpers", () => {
  it("normalizes @ prefixes and case", () => {
    expect(normalizeUsername("  @Lumen  ")).toBe("lumen");
  });

  it("distinguishes Fragment purchase-required names", () => {
    expect(classifyTelegramError("USERNAME_PURCHASE_AVAILABLE")).toBe("PURCHASE_REQUIRED");
  });

  it("recognizes occupied and invalid usernames", () => {
    expect(classifyTelegramError("USERNAME_OCCUPIED")).toBe("OCCUPIED");
    expect(classifyTelegramError("USERNAME_INVALID")).toBe("INVALID");
  });

  it("detects flood waits", () => {
    expect(classifyTelegramError("FLOOD_WAIT_120")).toBe("FLOOD_WAIT");
  });
});