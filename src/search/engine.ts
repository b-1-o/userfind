import { Candidate, generateCandidates, SearchMode } from "../generator/candidates.js";
import {
  TelegramCheckError,
  TelegramFloodWaitError,
  TelegramUsernameChecker
} from "../telegram/checker.js";

export interface SearchOptions {
  minLength: number;
  maxLength: number;
  resultLimit: number;
  maxCandidates: number;
  watchCandidatesLimit: number;
  durationMs: number;
  mode?: SearchMode;
  signal?: AbortSignal;
}

export interface AvailableCandidate extends Candidate {
  checkedAt: string;
}

export interface SearchProgress {
  checked: number;
  available: number;
  occupied: number;
  purchaseRequired: number;
  invalid: number;
  unknown: number;
  notBasicLength: number;
}

export interface SearchSummary extends SearchProgress {
  results: AvailableCandidate[];
  occupiedCandidates: Candidate[];
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  stopReason: "time_budget_reached" | "candidate_pool_exhausted" | "telegram_flood_wait" | "telegram_error" | "cancelled";
  floodWaitSeconds?: number;
  errorMessage?: string;
  candidatesGenerated: number;
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
    maxCandidates: options.maxCandidates,
    mode: options.mode ?? "standard"
  });

  const progress: SearchProgress = {
    checked: 0,
    available: 0,
    occupied: 0,
    purchaseRequired: 0,
    invalid: 0,
    unknown: 0,
    notBasicLength: 0
  };

  const results: AvailableCandidate[] = [];
  const occupiedCandidates: Candidate[] = [];
  let stopReason: SearchSummary["stopReason"] = "candidate_pool_exhausted";
  let floodWaitSeconds: number | undefined;
  let errorMessage: string | undefined;
  let lastProgressAt = Date.now();

  for (const candidate of candidates) {
    if (options.signal?.aborted) {
      stopReason = "cancelled";
      break;
    }

    if (Date.now() >= deadline) {
      stopReason = "time_budget_reached";
      break;
    }

    // Four-character names are excluded by the official Basic username rules.
    // They are never sent to Telegram and never represented as free.
    if (candidate.username.length < 5) {
      progress.notBasicLength += 1;
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
      } else if (check.status === "NOT_BASIC_LENGTH") {
        progress.notBasicLength += 1;
      } else if (check.status === "INVALID") {
        progress.invalid += 1;
      } else {
        progress.unknown += 1;
      }
    } catch (error) {
      if (error instanceof TelegramFloodWaitError) {
        stopReason = "telegram_flood_wait";
        floodWaitSeconds = error.waitSeconds;
        break;
      }

      stopReason = "telegram_error";
      progress.checked += 1;
      errorMessage = error instanceof TelegramCheckError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
      progress.unknown += 1;
      break;
    }

    if (progress.checked > 0 && (progress.checked % 15 === 0 || Date.now() - lastProgressAt > 25_000)) {
      await onProgress?.({ ...progress });
      lastProgressAt = Date.now();
    }
  }

  if (options.signal?.aborted && stopReason !== "telegram_flood_wait" && stopReason !== "telegram_error") {
    stopReason = "cancelled";
  } else if (Date.now() >= deadline && stopReason === "candidate_pool_exhausted") {
    stopReason = "time_budget_reached";
  }

  await onProgress?.({ ...progress });
  results.sort((left, right) =>
    right.score.total - left.score.total
    || left.username.length - right.username.length
    || left.username.localeCompare(right.username)
  );
  occupiedCandidates.sort((left, right) =>
    right.score.total - left.score.total
    || left.username.length - right.username.length
    || left.username.localeCompare(right.username)
  );

  return {
    ...progress,
    results: results.slice(0, options.resultLimit),
    occupiedCandidates: occupiedCandidates.slice(0, options.watchCandidatesLimit),
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedClock,
    stopReason,
    floodWaitSeconds,
    errorMessage,
    candidatesGenerated: candidates.length
  };
}
