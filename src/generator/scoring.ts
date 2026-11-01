export type CandidateSource = "dictionary" | "visual-mutation" | "brandable" | "constructed";

export interface ScoreBreakdown {
  total: number;
  lexical: number;
  pronunciation: number;
  visual: number;
  rarity: number;
  brandability: number;
}

const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

export function scoreCandidate(username: string, source: CandidateSource): ScoreBreakdown {
  const name = username.toLowerCase();
  const chars = [...name];
  const vowelCount = chars.filter((char) => VOWELS.has(char)).length;
  const vowelRatio = chars.length ? vowelCount / chars.length : 0;
  const uniqueRatio = new Set(chars).size / Math.max(1, chars.length);

  let longestConsonantRun = 0;
  let currentRun = 0;
  for (const char of chars) {
    if (VOWELS.has(char)) {
      currentRun = 0;
    } else {
      currentRun += 1;
      longestConsonantRun = Math.max(longestConsonantRun, currentRun);
    }
  }

  const idealVowelRatio = 0.38;
  const vowelFit = Math.max(0, 100 - Math.abs(vowelRatio - idealVowelRatio) * 180);
  const clusterPenalty = Math.max(0, longestConsonantRun - 2) * 19;
  const pronunciation = Math.max(8, Math.min(100, vowelFit - clusterPenalty));

  const duplicatePenalty = (1 - uniqueRatio) * 38;
  const hasBalancedLetters = vowelCount > 0 && vowelCount < chars.length;
  const visual = Math.max(
    10,
    Math.min(100, 72 + (uniqueRatio * 22) + (hasBalancedLetters ? 8 : -12) - duplicatePenalty)
  );

  const lexicalBySource: Record<CandidateSource, number> = {
    dictionary: 100,
    "visual-mutation": 78,
    brandable: 76,
    constructed: 57
  };
  const lexical = lexicalBySource[source];

  const rarityByLength: Record<number, number> = {
    4: 100,
    5: 94,
    6: 86,
    7: 76,
    8: 66,
    9: 56,
    10: 48
  };
  const rarity = rarityByLength[name.length] ?? Math.max(25, 48 - Math.max(0, name.length - 10) * 3);

  const brandability = Math.max(
    8,
    Math.min(100, pronunciation * 0.48 + visual * 0.32 + (source === "dictionary" ? 18 : 10))
  );

  const total = Math.round(
    lexical * 0.28 +
    pronunciation * 0.24 +
    visual * 0.18 +
    rarity * 0.18 +
    brandability * 0.12
  );

  return {
    total: Math.max(0, Math.min(100, total)),
    lexical: Math.round(lexical),
    pronunciation: Math.round(pronunciation),
    visual: Math.round(visual),
    rarity: Math.round(rarity),
    brandability: Math.round(brandability)
  };
}