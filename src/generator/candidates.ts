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

  const add = (raw: string, source: CandidateSource) => {
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

  const words = await loadDictionary();

  for (const word of words) {
    add(word, "dictionary");

    // Try one lowercase l -> i substitution at a time.
    // Telegram usernames are case-insensitive: uppercase I is not a distinct handle.
    for (let index = 0; index < word.length; index += 1) {
      if (word[index] !== "l") continue;
      const variant = word.slice(0, index) + "i" + word.slice(index + 1);
      add(variant, "visual-mutation");
    }
  }

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