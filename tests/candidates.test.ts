import { describe, expect, it } from "vitest";
import { generateCandidates } from "../src/generator/candidates.js";

describe("generateCandidates", () => {
  it("includes curated dictionary words in the selected length range", async () => {
    const candidates = await generateCandidates({
      minLength: 5,
      maxLength: 8,
      maxCandidates: 2_000
    });

    expect(candidates.some((candidate) => candidate.username === "lumen")).toBe(true);
    expect(candidates.every((candidate) => candidate.username.length >= 5 && candidate.username.length <= 8)).toBe(true);
  });

  it("creates lowercase l-to-i variants", async () => {
    const candidates = await generateCandidates({
      minLength: 5,
      maxLength: 8,
      maxCandidates: 2_000
    });

    expect(candidates.some((candidate) => candidate.username === "iumen" && candidate.source === "visual-mutation")).toBe(true);
  });
});