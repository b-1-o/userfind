import { Bot, Context } from "grammy";
import { config, requireBotToken } from "./config.js";
import { SearchProgress, runDeepSearch } from "./search/engine.js";
import { appendSearchHistory } from "./storage/result-store.js";
import {
  mergeWatchedCandidates,
  readWatchlist,
  removeWatchedUsername
} from "./storage/watch-store.js";
import { TelegramUsernameChecker } from "./telegram/checker.js";

function isOwner(ctx: Context): boolean {
  const userId = ctx.from?.id;
  // Never send private scan results into a group, even when the owner sends the command there.
  return ctx.chat?.type === "private"
    && typeof userId === "number"
    && config.allowedUserIds.has(userId);
}

function parseFindArguments(raw: string): { minLength: number; maxLength: number; resultLimit: number } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { minLength: 5, maxLength: 8, resultLimit: config.maxResults };
  }

  const match = trimmed.match(/^([0-9]{1,2})\s*-\s*([0-9]{1,2})(?:\s+([0-9]{1,2}))?$/);
  if (!match) {
    throw new Error("Use /find 5-8 or /find 5-8 20. The last number is the maximum results.");
  }

  const minLength = Number(match[1]);
  const maxLength = Number(match[2]);
  const requestedLimit = match[3] ? Number(match[3]) : config.maxResults;

  if (minLength < 4 || maxLength > 32 || minLength > maxLength || maxLength < 5) {
    throw new Error("Free Basic Telegram usernames must be 5–32 characters. Use /find 5-8; four-character names cannot be checked as free Basic usernames.");
  }
  if (requestedLimit < 1 || requestedLimit > 50) {
    throw new Error("Result limit must be between 1 and 50.");
  }

  return { minLength, maxLength, resultLimit: requestedLimit };
}

export function splitTelegramText(text: string, maxLength = 3_500): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const originalLine of text.split("\n")) {
    let line = originalLine;
    while (line.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(line.slice(0, maxLength));
      line = line.slice(maxLength);
    }

    const next = current ? current + "\n" + line : line;
    if (next.length > maxLength) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [""];
}

async function replyLongText(ctx: Context, text: string): Promise<void> {
  const chunks = splitTelegramText(text);
  await ctx.reply(chunks[0]!);
  for (const chunk of chunks.slice(1)) {
    await ctx.api.sendMessage(ctx.chat!.id, chunk);
  }
}

function progressText(progress: SearchProgress): string {
  return [
    "UserFind Deep Hunt is running…",
    "Checked: " + progress.checked,
    "Free and confirmed: " + progress.available,
    "Occupied: " + progress.occupied,
    "Fragment purchase required: " + progress.purchaseRequired,
    "Unknown/errors: " + progress.unknown,
    "Four-character names outside Basic rules: " + progress.notBasicLength,
    "",
    "All MTProto checks share one sequential rate limiter."
  ].join("\n");
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    AVAILABLE: "FREE BASIC — Telegram confirmed available at check time",
    OCCUPIED: "OCCUPIED",
    PURCHASE_REQUIRED: "NOT FREE — Telegram says it can be purchased through Fragment",
    NOT_BASIC_LENGTH: "NOT A FREE BASIC USERNAME — four characters are below the 5-character minimum",
    INVALID: "INVALID",
    UNKNOWN: "UNKNOWN — not treated as available"
  };
  return labels[status] ?? status;
}

export function createBot(checker: TelegramUsernameChecker): Bot {
  const bot = new Bot(requireBotToken());
  let activeSearchController: AbortController | null = null;

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "UserFind — quality-first Telegram username discovery.",
        "",
        "I rank meaningful words and brandable names first, then verify them with Telegram.",
        "Only Telegram-confirmed free Basic usernames are reported as available.",
        "",
        "Commands:",
        "/find — deep search (default lengths 5–8)",
        "/find 5-7 15 — choose length range and result count",
        "/check username — check one name",
        "/cancel — stop the active search",
        "/watchlist — names monitored for future release",
        "/unwatch username — stop monitoring a name",
        "/id — show your Telegram numeric ID",
        "/help — help",
        "",
        "Four-character names are not eligible for free Basic usernames; their Fragment status is not checked here."
      ].join("\n")
    );
  });

  bot.command("id", async (ctx) => {
    await ctx.reply("Your Telegram user ID: " + String(ctx.from?.id ?? "unknown"));
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "UserFind commands",
        "",
        "/find — search lengths 5–8",
        "/find 5-7 20 — search lengths 5–7 and return up to 20 matches",
        "/check @username — check one username",
        "/cancel — cancel the active deep search",
        "/watchlist — see occupied names monitored for release",
        "/unwatch username — remove a name from monitoring",
        "/id — show your numeric Telegram user ID",
        "",
        "A name is shown as FREE only if Telegram's account.checkUsername returns true.",
        "USERNAME_PURCHASE_AVAILABLE is never counted as free.",
        "Occupied high-quality candidates are monitored and rechecked every few hours.",
        "A successful check does not reserve the username; claim it immediately in Telegram."
      ].join("\n")
    );
  });

  bot.command("watchlist", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is available only in the bot's private chat for the configured owner.");
      return;
    }

    const entries = await readWatchlist();
    if (!entries.length) {
      await ctx.reply("Your release watchlist is empty. Run /find to discover and track high-quality occupied candidates.");
      return;
    }

    const lines = [
      "Release watchlist",
      "These names were confirmed occupied. UserFind rechecks them periodically; it does not infer inactivity."
    ];
    entries.slice(0, 40).forEach((entry, index) => {
      lines.push(
        "",
        (index + 1) + ". @" + entry.username + " — quality " + entry.score + "/100",
        "Added: " + entry.addedAt
      );
    });
    if (entries.length > 40) lines.push("", "Showing 40 of " + entries.length + " tracked names.");
    lines.push("", "Use /unwatch username to remove one.");
    await replyLongText(ctx, lines.join("\n"));
  });

  bot.command("unwatch", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is available only in the bot's private chat for the configured owner.");
      return;
    }

    const username = String(ctx.match ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!username) {
      await ctx.reply("Usage: /unwatch username");
      return;
    }

    const removed = await removeWatchedUsername(username);
    await ctx.reply(removed ? "Removed @" + username + " from the release watchlist." : "@" + username + " was not on the watchlist.");
  });

  bot.command("check", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is available only in the bot's private chat for the configured owner.");
      return;
    }

    const username = String(ctx.match ?? "").trim();
    if (!username) {
      await ctx.reply("Usage: /check username");
      return;
    }

    try {
      const result = await checker.check(username);
      await ctx.reply(
        "@" + result.username + "\n" +
        formatStatus(result.status) + "\n" +
        result.detail + "\n" +
        "Checked: " + result.checkedAt
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply("Check stopped: " + message);
    }
  });

  bot.command("cancel", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is available only in the bot's private chat for the configured owner.");
      return;
    }

    if (!activeSearchController) {
      await ctx.reply("There is no active search to cancel.");
      return;
    }

    activeSearchController.abort();
    await ctx.reply("Cancellation requested. The current Telegram request will finish safely; no further usernames will be checked.");
  });

  bot.command("find", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("This command is available only in the bot's private chat for the configured owner.");
      return;
    }

    if (activeSearchController) {
      await ctx.reply("A deep search is already running. Use /cancel before starting another.");
      return;
    }

    let args: ReturnType<typeof parseFindArguments>;
    try {
      args = parseFindArguments(String(ctx.match ?? ""));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Invalid search arguments.");
      return;
    }

    const controller = new AbortController();
    activeSearchController = controller;
    const chatId = ctx.chat!.id;
    let statusMessage: { message_id: number } | undefined;
    let lastEditAt = Date.now();

    try {
      statusMessage = await ctx.reply(
        "Preparing candidates…\nRange: " + args.minLength + "–" + args.maxLength + "\nTime budget: up to 10 minutes."
      );

      const summary = await runDeepSearch(
        checker,
        {
          minLength: args.minLength,
          maxLength: args.maxLength,
          resultLimit: args.resultLimit,
          maxCandidates: config.maxCandidates,
          watchCandidatesLimit: config.watchMaxEntries,
          durationMs: config.searchDurationMs,
          signal: controller.signal
        },
        async (progress) => {
          if (Date.now() - lastEditAt < 25_000 || !statusMessage) return;
          await ctx.api.editMessageText(chatId, statusMessage.message_id, progressText(progress));
          lastEditAt = Date.now();
        }
      );

      const storageWarnings: string[] = [];
      try {
        await appendSearchHistory(summary);
      } catch (error) {
        console.error("Could not save search history:", error);
        storageWarnings.push("Search history could not be saved.");
      }

      let watchedCount = 0;
      try {
        watchedCount = await mergeWatchedCandidates(summary.occupiedCandidates, config.watchMaxEntries);
      } catch (error) {
        console.error("Could not update release watchlist:", error);
        storageWarnings.push("Release watchlist could not be updated.");
      }

      const lines = [
        "UserFind Deep Hunt finished",
        "",
        "Checked: " + summary.checked,
        "Confirmed free: " + summary.available,
        "Occupied: " + summary.occupied,
        "Fragment purchase required (not free): " + summary.purchaseRequired,
        "Unknown/errors: " + summary.unknown,
        "Four-character names outside Basic rules: " + summary.notBasicLength,
        "Generated candidates: " + summary.candidatesGenerated,
        "Names kept under release monitoring: " + watchedCount,
        "Recheck interval: " + Math.round(config.watchIntervalMs / 3_600_000) + " hours",
        "Elapsed: " + Math.round(summary.elapsedMs / 1000) + " seconds"
      ];

      if (summary.stopReason === "telegram_flood_wait") {
        lines.push("Stopped because Telegram requested FLOOD_WAIT (" + summary.floodWaitSeconds + " seconds). All further checks are paused; no limit bypass was attempted.");
      } else if (summary.stopReason === "telegram_error") {
        lines.push("Stopped because the Telegram check failed: " + (summary.errorMessage ?? "unknown API error"));
      } else if (summary.stopReason === "time_budget_reached") {
        lines.push("Stopped at the configured time budget.");
      } else if (summary.stopReason === "cancelled") {
        lines.push("Search cancelled by the owner. The in-flight request, if any, was allowed to finish.");
      }

      if (storageWarnings.length) {
        lines.push("", ...storageWarnings);
      }

      if (summary.results.length) {
        lines.push("", "Best Telegram-confirmed free results:");
        summary.results.forEach((result, index) => {
          lines.push(
            "",
            String(index + 1) + ". @" + result.username + " — quality " + result.score.total + "/100",
            "Source: " + result.source + " | checked " + result.checkedAt,
            "https://t.me/" + result.username
          );
        });
        lines.push("", "These checks do not reserve the names. Open Telegram and claim a result immediately; availability can change.");
      } else {
        lines.push("", "No free username was confirmed in this run. Unknown and purchase-required names were not counted as free.");
      }

      if (args.minLength === 4) {
        lines.push("", "Four-character candidates were excluded from free results: Telegram's Basic username checker requires at least five characters. This bot does not verify their Fragment NFT listings.");
      }

      const chunks = splitTelegramText(lines.join("\n"));
      if (!statusMessage) {
        await ctx.api.sendMessage(chatId, chunks[0]!);
      } else {
        try {
          await ctx.api.editMessageText(chatId, statusMessage.message_id, chunks[0]!);
        } catch (editError) {
          console.error("Could not edit search status message; sending a new message:", editError);
          await ctx.api.sendMessage(chatId, chunks[0]!);
        }
      }
      for (const chunk of chunks.slice(1)) {
        await ctx.api.sendMessage(chatId, chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        if (statusMessage) {
          await ctx.api.editMessageText(chatId, statusMessage.message_id, "Search failed: " + message);
        } else {
          await ctx.api.sendMessage(chatId, "Search failed: " + message);
        }
      } catch (deliveryError) {
        console.error("Could not send search error to owner:", deliveryError);
      }
    } finally {
      if (activeSearchController === controller) activeSearchController = null;
    }
  });

  bot.catch((error) => {
    console.error("Bot update error:", error.error);
  });

  return bot;
}

export async function startBot(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Start UserFind" },
    { command: "find", description: "Find free usernames" },
    { command: "check", description: "Check one username" },
    { command: "cancel", description: "Cancel the active search" },
    { command: "watchlist", description: "Show watched occupied usernames" },
    { command: "unwatch", description: "Remove a username from monitoring" },
    { command: "id", description: "Show your numeric Telegram ID" },
    { command: "help", description: "Show help" }
  ]);

  await bot.start({
    onStart: (botInfo) => console.log("UserFind bot started as @" + botInfo.username)
  });
}