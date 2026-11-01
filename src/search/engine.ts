import { Candidate, generateCandidates } from "../generator/candidates.js";
import { TelegramFloodWaitError, TelegramUsernameChecker } from "../telegram/checker.js";

export interface SearchOptions {
  minLength: number;
  maxLength: number;
  resultLimit: number;
  maxCandidates: number;
  watchCandidatesLimit: number;
  durationMs: number;
  intervalMs: number;
}

export interface AvailableCandidate extends Candidate {
  checkedAt: string;
}

export interface SearchProgress {
  checked: number;
  available: number;
  occupied: number;
  purchaseRequired: number;
  unknown: number;
  collectibleOnly: number;
}

export interface SearchSummary extends SearchProgress {
  results: AvailableCandidate[];
  occupiedCandidates: Candidate[];
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  stopReason: "time_budget_reached" | "candidate_pool_exhausted" | "telegram_flood_wait";
  floodWaitSeconds?: number;
  candidatesGenerated: number;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runDeepSearch(
  checker: TelegramUsernameChecker,
  options: SearchOptions,
  onProgress?: (progress: SearchProgress) => Promise<void> | void
): Promise<SearchSummary> {
  const startedAt = new Date().toISOString();
  const startedClock = Date.now();
  const deadline = startedClock + options.durationMs;

  const candidates = await generateCandidates({
    minLength: options.minLength,
    maxLength: options.maxLength,
    maxCandidates: options.maxCandidates
  });

  const progress: SearchProgress = {
    checked: 0,
    available: 0,
    occupied: 0,
    purchaseRequired: 0,
    unknown: 0,
    collectibleOnly: 0
  };

  const results: AvailableCandidate[] = [];
  const occupiedCandidates: Candidate[] = [];
  let stopReason: SearchSummary["stopReason"] = "candidate_pool_exhausted";
  let floodWaitSeconds: number | undefined;
  let lastProgressAt = Date.now();

  for (const candidate of candidates) {
    if (Date.now() >= deadline) {
      stopReason = "time_budget_reached";
      break;
    }

    // Four-character Telegram handles are collectible-only, not free Basic usernames.
    if (candidate.username.length === 4) {
      progress.collectibleOnly += 1;
      continue;
    }

    try {
      const check = await checker.check(candidate.username);
      progress.checked += 1;

      if (check.status === "AVAILABLE" && check.claimable) {
        progress.available += 1;
        results.push({ ...candidate, checkedAt: check.checkedAt });
      } else if (check.status === "OCCUPIED") {
        progress.occupied += 1;
        occupiedCandidates.push(candidate);
      } else if (check.status === "PURCHASE_REQUIRED") {
        progress.purchaseRequired += 1;
      } else if (check.status === "COLLECTIBLE_ONLY") {
        progress.collectibleOnly += 1;
      } else {
        progress.unknown += 1;
      }
    } catch (error) {
      if (error instanceof TelegramFloodWaitError) {
        stopReason = "telegram_flood_wait";
        floodWaitSeconds = error.waitSeconds;
        break;
      }

      progress.checked += 1;
      progress.unknown += 1;
    }

    if (progress.checked > 0 && (progress.checked % 15 === 0 || Date.now() - lastProgressAt > 25_000)) {
      await onProgress?.({ ...progress });
      lastProgressAt = Date.now();
    }

    if (Date.now() + options.intervalMs >= deadline) {
      stopReason = "time_budget_reached";
      break;
    }

    await sleep(options.intervalMs);
  }

  if (Date.now() >= deadline) {
    stopReason = "time_budget_reached";
  }

  await onProgress?.({ ...progress });
  results.sort((left, right) => right.score.total - left.score.total);
  occupiedCandidates.sort((left, right) => right.score.total - left.score.total);

  return {
    ...progress,
    results: results.slice(0, options.resultLimit),
    occupiedCandidates: occupiedCandidates.slice(0, options.watchCandidatesLimit),
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedClock,
    stopReason,
    floodWaitSeconds,
    candidatesGenerated: candidates.length
  };
}