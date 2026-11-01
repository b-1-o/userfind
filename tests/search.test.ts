import { describe, expect, it, vi } from "vitest";
import { TelegramCheckError, TelegramUsernameChecker } from "../src/telegram/checker.js";
import { runDeepSearch } from "../src/search/engine.js";

const baseOptions = {
  minLength: 5,
  maxLength: 5,
  resultLimit: 5,
  maxCandidates: 40,
  watchCandidatesLimit: 10,
  durationMs: 10_000
};

describe("runDeepSearch", () => {
  it("stops after an unexpected Telegram error instead of continuing to issue requests", async () => {
    const check = vi.fn().mockRejectedValue(new TelegramCheckError("AUTH_KEY_UNREGISTERED"));
    const checker = { check } as unknown as TelegramUsernameChecker;

    const summary = await runDeepSearch(checker, baseOptions);

    expect(summary.stopReason).toBe("telegram_error");
    expect(summary.errorMessage).toContain("AUTH_KEY_UNREGISTERED");
    expect(check).toHaveBeenCalledTimes(1);
    expect(summary.unknown).toBe(1);
  });

  it("honors an already-aborted search signal", async () => {
    const check = vi.fn();
    const checker = { check } as unknown as TelegramUsernameChecker;
    const controller = new AbortController();
    controller.abort();

    const summary = await runDeepSearch(checker, {
      ...baseOptions,
      signal: controller.signal
    });

    expect(summary.stopReason).toBe("cancelled");
    expect(summary.checked).toBe(0);
    expect(check).not.toHaveBeenCalled();
  });
});