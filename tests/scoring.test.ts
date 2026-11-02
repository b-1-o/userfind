import { describe, expect, it } from "vitest";
import { scoreCandidate } from "../src/generator/scoring.js";

describe("scoreCandidate", () => {
  it("ranks meaningful words and names above generated constructions", () => {
    const word = scoreCandidate("lumen", "dictionary");
    const name = scoreCandidate("pavel", "given-name");
    const random = scoreCandidate("xqvzq", "constructed");
    expect(word.total).toBeGreaterThan(random.total);
    expect(name.total).toBeGreaterThan(random.total);
  });

  it("gives five-character names a stronger short-name score than longer variants", () => {
    const shortWord = scoreCandidate("dobro", "russian-translit");
    const longerWord = scoreCandidate("radost", "russian-translit");
    expect(shortWord.rarity).toBeGreaterThan(longerWord.rarity);
  });

  it("returns bounded integer scores", () => {
    const score = scoreCandidate("velora", "brandable");
    expect(Number.isInteger(score.total)).toBe(true);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });
});
