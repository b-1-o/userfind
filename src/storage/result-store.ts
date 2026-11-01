import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SearchSummary } from "../search/engine.js";

export interface SearchHistoryEntry {
  completedAt: string;
  elapsedMs: number;
  checked: number;
  available: number;
  usernames: string[];
}

const historyPath = resolve(process.cwd(), "data/search-history.json");

export async function appendSearchHistory(summary: SearchSummary): Promise<void> {
  await mkdir(dirname(historyPath), { recursive: true });

  let history: SearchHistoryEntry[] = [];
  try {
    const content = await readFile(historyPath, "utf8");
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed)) history = parsed as SearchHistoryEntry[];
  } catch {
    history = [];
  }

  history.push({
    completedAt: summary.finishedAt,
    elapsedMs: summary.elapsedMs,
    checked: summary.checked,
    available: summary.available,
    usernames: summary.results.map((result) => result.username)
  });

  const temporaryPath = historyPath + ".tmp";
  await writeFile(temporaryPath, JSON.stringify(history.slice(-100), null, 2), "utf8");
  await rename(temporaryPath, historyPath);
}