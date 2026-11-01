import "dotenv/config";
import { z } from "zod";

const optionalPositiveInt = z.preprocess(
  (value) => value === undefined || value === "" ? undefined : Number(value),
  z.number().int().positive().optional()
);

const envSchema = z.object({
  BOT_TOKEN: z.string().default(""),
  TG_API_ID: optionalPositiveInt,
  TG_API_HASH: z.string().default(""),
  TG_SESSION: z.string().default(""),
  BOT_ALLOWED_USER_IDS: z.string().default(""),
  CHECK_INTERVAL_MS: z.coerce.number().int().min(1_000).max(10_000).default(1_500),
  SEARCH_DURATION_MS: z.coerce.number().int().min(10_000).max(600_000).default(600_000),
  MAX_CANDIDATES: z.coerce.number().int().min(100).max(20_000).default(6_000),
  MAX_RESULTS: z.coerce.number().int().min(1).max(50).default(15),
  WATCH_INTERVAL_MS: z.coerce.number().int().min(3_600_000).max(604_800_000).default(21_600_000),
  WATCH_MAX_ENTRIES: z.coerce.number().int().min(10).max(500).default(150)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error("Invalid environment configuration: " + parsed.error.message);
}

const values = parsed.data;

export const config = {
  botToken: values.BOT_TOKEN,
  apiId: values.TG_API_ID,
  apiHash: values.TG_API_HASH,
  session: values.TG_SESSION,
  allowedUserIds: new Set(
    values.BOT_ALLOWED_USER_IDS
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0)
  ),
  checkIntervalMs: values.CHECK_INTERVAL_MS,
  searchDurationMs: values.SEARCH_DURATION_MS,
  maxCandidates: values.MAX_CANDIDATES,
  maxResults: values.MAX_RESULTS,
  watchIntervalMs: values.WATCH_INTERVAL_MS,
  watchMaxEntries: values.WATCH_MAX_ENTRIES
};

export function requireBotToken(): string {
  if (!config.botToken) {
    throw new Error("BOT_TOKEN is missing. Add your bot token to .env.");
  }
  return config.botToken;
}

export function requireTelegramCredentials(): { apiId: number; apiHash: string } {
  if (!config.apiId || !config.apiHash) {
    throw new Error("TG_API_ID and TG_API_HASH are required. Get them from my.telegram.org.");
  }
  return { apiId: config.apiId, apiHash: config.apiHash };
}

export function requireTelegramSession(): string {
  if (!config.session) {
    throw new Error("TG_SESSION is missing. Run npm run auth and add the generated session to .env.");
  }
  return config.session;
}