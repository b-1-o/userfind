export type CandidateSource =
  | "dictionary"
  | "russian-translit"
  | "given-name"
  | "surname"
  | "visual-mutation"
  | "brandable"
  | "constructed";

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

  const vowelFit = Math.max(0, 100 - Math.abs(vowelRatio - 0.40) * 190);
  const clusterPenalty = Math.max(0, longestConsonantRun - 2) * 22;
  const pronunciation = Math.max(5, Math.min(100, vowelFit - clusterPenalty));

  const isPalindrome = name === [...name].reverse().join("");
  const alternatesVowelsAndConsonants = chars.length > 3
    && chars.every((char, index) => index === 0 || VOWELS.has(char) !== VOWELS.has(chars[index - 1]!));
  const duplicatePenalty = (1 - uniqueRatio) * 34;
  const hasBalancedLetters = vowelCount > 0 && vowelCount < chars.length;
  const visual = Math.max(
    8,
    Math.min(
      100,
      68
        + (uniqueRatio * 23)
        + (hasBalancedLetters ? 8 : -14)
        + (isPalindrome ? 10 : 0)
        + (alternatesVowelsAndConsonants ? 5 : 0)
        - duplicatePenalty
    )
  );

  // Meaningful words and real name patterns dominate. Generated constructions
  // remain supported for compatibility, but are intentionally scored low.
  const lexicalBySource: Record<CandidateSource, number> = {
    dictionary: 100,
    "russian-translit": 99,
    "given-name": 98,
    surname: 96,
    "visual-mutation": 42,
    brandable: 48,
    constructed: 24
  };
  const lexical = lexicalBySource[source];

  const rarityByLength: Record<number, number> = {
    4: 100,
    5: 100,
    6: 92,
    7: 79,
    8: 67,
    9: 55,
    10: 45
  };
  const rarity = rarityByLength[name.length] ?? Math.max(20, 45 - Math.max(0, name.length - 10) * 3);

  const brandability = Math.max(
    5,
    Math.min(100, pronunciation * 0.52 + visual * 0.38 + (lexical >= 90 ? 8 : 0))
  );

  const total = Math.round(
    lexical * 0.42
      + pronunciation * 0.22
      + visual * 0.16
      + rarity * 0.15
      + brandability * 0.05
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
