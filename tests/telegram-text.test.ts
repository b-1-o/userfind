import { describe, expect, it } from "vitest";
import { splitTelegramText } from "../src/bot.js";

describe("splitTelegramText", () => {
  it("keeps every Telegram message under the configured safe length", () => {
    const source = Array.from({ length: 120 }, (_, index) => String(index).padEnd(48, "x")).join("\n");
    const chunks = splitTelegramText(source);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 3_500)).toBe(true);
    expect(chunks.join("\n")).toBe(source);
  });

  it("splits a single overlong line", () => {
    const source = "x".repeat(8_000);
    const chunks = splitTelegramText(source);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 3_500)).toBe(true);
    expect(chunks.join("")).toBe(source);
  });
});