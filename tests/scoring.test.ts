import { describe, expect, it } from "vitest";
import { scoreCandidate } from "../src/generator/scoring.js";

describe("scoreCandidate", () => {
  it("ranks a dictionary word above a random-looking construction", () => {
    const word = scoreCandidate("lumen", "dictionary");
    const random = scoreCandidate("xqvzq", "constructed");
    expect(word.total).toBeGreaterThan(random.total);
  });

  it("returns bounded integer scores", () => {
    const score = scoreCandidate("velora", "brandable");
    expect(Number.isInteger(score.total)).toBe(true);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });
});