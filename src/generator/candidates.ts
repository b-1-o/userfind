import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CandidateSource, ScoreBreakdown, scoreCandidate } from "./scoring.js";

export type SearchMode = "standard" | "short";

export interface Candidate {
  username: string;
  source: CandidateSource;
  score: ScoreBreakdown;
}

export interface CandidateOptions {
  minLength: number;
  maxLength: number;
  maxCandidates: number;
  mode?: SearchMode;
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

async function loadWordList(fileName: string): Promise<string[]> {
  // Source mode resolves to ../../data; the production build resolves to ../data.
  const paths = [
    resolve(moduleDirectory, "../../data", fileName),
    resolve(moduleDirectory, "../data", fileName)
  ];

  for (const path of paths) {
    try {
      const raw = await readFile(path, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => /^[a-z]{3,32}$/.test(line));
    } catch {
      // Try the next known source/build asset location.
    }
  }

  console.error("Could not load candidate word list: " + fileName);
  return [];
}

function isCandidate(value: string): boolean {
  return /^[a-z]{5,32}$/.test(value);
}

export async function generateCandidates(options: CandidateOptions): Promise<Candidate[]> {
  const mode = options.mode ?? "standard";
  const candidates = new Map<string, Candidate>();

  const add = (raw: string, source: CandidateSource) => {
    const username = raw.toLowerCase().trim();
    if (!isCandidate(username)) return;
    if (username.length < Math.max(5, options.minLength) || username.length > options.maxLength) return;
    if (mode === "short" && username.length > 6) return;
    if (candidates.has(username)) return;

    candidates.set(username, {
      username,
      source,
      score: scoreCandidate(username, source)
    });
  };

  const lists: Array<[string, CandidateSource]> = [
    ["words-en.txt", "dictionary"],
    ["words-ru-latin.txt", "russian-translit"],
    ["names-given.txt", "given-name"],
    ["names-surname.txt", "surname"]
  ];

  for (const [fileName, source] of lists) {
    const words = await loadWordList(fileName);
    for (const word of words) add(word, source);
  }

  return [...candidates.values()]
    .sort((left, right) =>
      right.score.total - left.score.total
      || left.username.length - right.username.length
      || left.username.localeCompare(right.username)
    )
    .slice(0, options.maxCandidates);
}
