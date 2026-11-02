import { describe, expect, it } from "vitest";
import { generateCandidates } from "../src/generator/candidates.js";

describe("generateCandidates", () => {
  it("includes English words, Russian transliterations, given names and surnames", async () => {
    const candidates = await generateCandidates({
      minLength: 5,
      maxLength: 8,
      maxCandidates: 2_000
    });

    const byName = new Map(candidates.map((candidate) => [candidate.username, candidate]));
    expect(byName.get("lumen")?.source).toBe("dictionary");
    expect(byName.get("dobro")?.source).toBe("russian-translit");
    expect(byName.get("sokol")?.source).toBe("russian-translit");
    expect(byName.get("pavel")?.source).toBe("given-name");
    expect(byName.get("durov")?.source).toBe("surname");
    expect(byName.has("erik")).toBe(false);
    expect(candidates.every((candidate) => candidate.username.length >= 5 && candidate.username.length <= 8)).toBe(true);
  });

  it("does not create random visual substitutions such as l-to-i variants", async () => {
    const candidates = await generateCandidates({
      minLength: 5,
      maxLength: 8,
      maxCandidates: 2_000
    });

    expect(candidates.some((candidate) => candidate.username === "iumen")).toBe(false);
    expect(candidates.every((candidate) => !["visual-mutation", "constructed"].includes(candidate.source))).toBe(true);
  });

  it("short mode only returns five- and six-character candidates", async () => {
    const candidates = await generateCandidates({
      minLength: 5,
      maxLength: 32,
      maxCandidates: 2_000,
      mode: "short"
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.username.length === 5 || candidate.username.length === 6)).toBe(true);
    expect(candidates.some((candidate) => candidate.username === "pavel")).toBe(true);
  });
});
