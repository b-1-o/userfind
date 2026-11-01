import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CandidateSource, ScoreBreakdown, scoreCandidate } from "./scoring.js";

export interface Candidate {
  username: string;
  source: CandidateSource;
  score: ScoreBreakdown;
}

export interface CandidateOptions {
  minLength: number;
  maxLength: number;
  maxCandidates: number;
}

const prefixes = [
  "aero", "aura", "astra", "aure", "cora", "elio", "echo", "ely", "hera",
  "ivor", "luma", "lyra", "mira", "nexa", "nori", "nova", "nyra", "onyx",
  "ora", "orbi", "sora", "sola", "vanta", "vela", "vero", "vexa", "zora"
];

const suffixes = [
  "a", "ae", "ara", "elle", "en", "ia", "io", "is", "ix", "on", "ora",
  "or", "ra", "um", "us", "va", "yn"
];

const syllables = [
  "aer", "ari", "ava", "bel", "cora", "dara", "ela", "elio", "era", "ira",
  "ivo", "luma", "lyra", "mira", "nexa", "nora", "nori", "ora", "sela",
  "sora", "vani", "vela", "vero", "vexa", "yara", "zora"
];

async function loadDictionary(): Promise<string[]> {
  const path = resolve(process.cwd(), "data/words-en.txt");
  try {
    const raw = await readFile(path, "utf8");
    return raw.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

function isCandidate(value: string): boolean {
  return /^[a-z]{4,32}$/.test(value);
}

export async function generateCandidates(options: CandidateOptions): Promise<Candidate[]> {
  const candidates = new Map<string, Candidate>();

  const addExact = (raw: string, source: CandidateSource) => {
    const username = raw.toLowerCase();
    if (!isCandidate(username)) return;
    if (username.length < options.minLength || username.length > options.maxLength) return;
    if (candidates.has(username)) return;

    candidates.set(username, {
      username,
      source,
      score: scoreCandidate(username, source)
    });
  };

  const add = (raw: string, source: CandidateSource) => {
    const username = raw.toLowerCase();
    addExact(username, source);

    if (source === "visual-mutation") return;

    const positions = [...username]
      .map((char, index) => char === "l" ? index : -1)
      .filter((index) => index >= 0);

    // Generate every non-empty combination of lowercase l -> i substitutions.
    // Uppercase I is not a separate Telegram username because usernames are case-insensitive.
    const combinations = 1 << Math.min(positions.length, 8);
    for (let mask = 1; mask < combinations; mask += 1) {
      const chars = [...username];
      positions.forEach((position, bit) => {
        if (bit < 8 && (mask & (1 << bit)) !== 0) chars[position] = "i";
      });
      addExact(chars.join(""), "visual-mutation");
    }
  };

  const words = await loadDictionary();
  for (const word of words) add(word, "dictionary");

  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      add(prefix + suffix, "brandable");
    }
  }

  for (const first of syllables) {
    for (const second of syllables) {
      add(first + second, "constructed");
    }
  }

  return [...candidates.values()]
    .sort((left, right) => right.score.total - left.score.total || left.username.localeCompare(right.username))
    .slice(0, options.maxCandidates);
}