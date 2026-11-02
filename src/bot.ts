import { Bot, Context, Keyboard } from "grammy";
import { config, requireBotToken } from "./config.js";
import { SearchMode } from "./generator/candidates.js";
import { SearchProgress, runDeepSearch } from "./search/engine.js";
import { isSearchActive, setSearchActive } from "./search/activity.js";
import { appendSearchHistory } from "./storage/result-store.js";
import {
  mergeWatchedCandidates,
  readWatchlist,
  removeWatchedUsername
} from "./storage/watch-store.js";
import { TelegramUsernameChecker } from "./telegram/checker.js";

const mainKeyboard = new Keyboard()
  .text("🔎 Обычный поиск").text("⚡ Короткие 5–6")
  .row()
  .text("4️⃣ Четыре символа").text("✅ Проверить имя")
  .row()
  .text("👁 Список наблюдения").text("🛑 Остановить поиск")
  .row()
  .text("🆔 Мой ID").text("ℹ️ Помощь")
  .resized();

function isOwner(ctx: Context): boolean {
  const userId = ctx.from?.id;
  // Never send private scan results into a group, even when the owner sends a button there.
  return ctx.chat?.type === "private"
    && typeof userId === "number"
    && config.allowedUserIds.has(userId);
}

function parseFindArguments(
  raw: string,
  mode: SearchMode
): { minLength: number; maxLength: number; resultLimit: number; mode: SearchMode } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      minLength: 5,
      maxLength: mode === "short" ? 6 : 8,
      resultLimit: config.maxResults,
      mode
    };
  }

  const match = trimmed.match(/^([0-9]{1,2})\s*-\s*([0-9]{1,2})(?:\s+([0-9]{1,2}))?$/);
  if (!match) {
    throw new Error("Укажи диапазон, например 5-8 или 5-6 20. Минимальная длина бесплатного Basic username — 5 символов.");
  }

  const minLength = Number(match[1]);
  const maxLength = Number(match[2]);
  const requestedLimit = match[3] ? Number(match[3]) : config.maxResults;

  if (minLength < 5 || maxLength > 32 || minLength > maxLength || maxLength < 5) {
    throw new Error("Бесплатные Basic usernames имеют длину 5–32 символа. Четырёхсимвольные имена нельзя подтвердить как бесплатные Basic usernames.");
  }
  if (mode === "short" && maxLength > 6) {
    throw new Error("В коротком режиме доступны только имена длиной 5–6 символов.");
  }
  if (requestedLimit < 1 || requestedLimit > 50) {
    throw new Error("Количество результатов должно быть от 1 до 50.");
  }

  return { minLength, maxLength, resultLimit: requestedLimit, mode };
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
  await ctx.reply(chunks[0]!, { reply_markup: mainKeyboard });
  for (const chunk of chunks.slice(1)) {
    await ctx.api.sendMessage(ctx.chat!.id, chunk);
  }
}

function progressText(progress: SearchProgress): string {
  return [
    "UserFind — поиск выполняется…",
    "Проверено: " + progress.checked,
    "Свободны и подтверждены: " + progress.available,
    "Заняты: " + progress.occupied,
    "Требуют покупки: " + progress.purchaseRequired,
    "Отклонены Telegram (invalid / reserved): " + progress.invalid,
    "Неизвестные ошибки: " + progress.unknown,
    "Вне Basic (4 символа): " + progress.notBasicLength,
    "",
    "Все MTProto-проверки проходят через одну последовательную очередь."
  ].join("\n");
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    AVAILABLE: "СВОБОДЕН BASIC — Telegram подтвердил доступность на момент проверки",
    OCCUPIED: "ЗАНЯТ",
    PURCHASE_REQUIRED: "НЕ БЕСПЛАТНЫЙ — Telegram сообщает, что имя доступно только для покупки",
    NOT_BASIC_LENGTH: "НЕ BASIC — минимальная длина бесплатного Basic username составляет 5 символов",
    INVALID: "НЕДОПУСТИМЫЙ USERNAME",
    UNKNOWN: "НЕИЗВЕСТНО — не считается свободным"
  };
  return labels[status] ?? status;
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    dictionary: "английское слово",
    "russian-translit": "русское слово в латинице",
    "given-name": "имя",
    surname: "фамилия",
    "visual-mutation": "вариант написания",
    brandable: "брендовая комбинация",
    constructed: "составное имя"
  };
  return labels[source] ?? source;
}

const fourCharacterInfo = [
  "Режим четырёхсимвольных имён",
  "",
  "Здесь есть ограничение самого Telegram: бесплатный Basic username должен содержать 5–32 символа.",
  "Поэтому имя из 4 символов нельзя подтвердить как свободное Basic-имя через официальный метод проверки.",
  "Я не буду помечать такие варианты как бесплатные или обещать, что их можно забрать.",
  "",
  "Чтобы найти максимально короткое свободное имя, используй режим «Короткие 5–6»."
].join("\n");

export function createBot(checker: TelegramUsernameChecker): Bot {
  const bot = new Bot(requireBotToken());
  let activeSearchController: AbortController | null = null;
  const pendingUsernameChecks = new Set<number>();

  const showHelp = async (ctx: Context) => {
    await ctx.reply(
      [
        "UserFind — поиск коротких и осмысленных Telegram username.",
        "",
        "Кнопки внизу:",
        "🔎 Обычный поиск — имена 5–8 символов.",
        "⚡ Короткие 5–6 — в первую очередь самые короткие осмысленные слова и имена.",
        "4️⃣ Правила 4 символов — почему их нельзя подтвердить как бесплатные Basic usernames.",
        "✅ Проверить имя — проверить один username.",
        "👁 Список наблюдения — занятые имена, которые перепроверяются.",
        "🛑 Остановить поиск — остановить текущий поиск.",
        "🆔 Мой ID — показать числовой ID.",
        "",
        "Генератор использует английские слова, транслитерацию русских слов, имена и фамилии.",
        "Свободным результат считается только после подтверждения Telegram. Покупка через Fragment и неизвестные статусы не считаются свободными.",
        "",
        "Клавиатуру можно свернуть стандартной кнопкой Telegram; /menu снова покажет её.",
        "Слэш-команды тоже поддерживаются: /find, /short, /check, /cancel, /watchlist, /unwatch, /id, /four, /menu."
      ].join("\n"),
      { reply_markup: mainKeyboard }
    );
  };

  const showWatchlist = async (ctx: Context) => {
    if (!isOwner(ctx)) {
      await ctx.reply("Список наблюдения доступен только владельцу в личном чате.", { reply_markup: mainKeyboard });
      return;
    }

    const entries = await readWatchlist();
    if (!entries.length) {
      await ctx.reply("Список наблюдения пуст. Запусти поиск, чтобы добавить качественные занятые имена.", { reply_markup: mainKeyboard });
      return;
    }

    const lines = [
      "Список наблюдения",
      "Эти имена ранее были подтверждены как занятые. UserFind периодически проверяет их снова; неактивность аккаунта не предполагается."
    ];
    entries.slice(0, 40).forEach((entry, index) => {
      lines.push(
        "",
        (index + 1) + ". @" + entry.username + " — качество " + entry.score + "/100",
        "Добавлено: " + entry.addedAt
      );
    });
    if (entries.length > 40) lines.push("", "Показано 40 из " + entries.length + ".");
    lines.push("", "Для удаления используй /unwatch username.");
    await replyLongText(ctx, lines.join("\n"));
  };

  const cancelSearch = async (ctx: Context) => {
    pendingUsernameChecks.delete(ctx.from?.id ?? -1);
    if (!isOwner(ctx)) {
      await ctx.reply("Остановка поиска доступна только владельцу в личном чате.", { reply_markup: mainKeyboard });
      return;
    }
    if (!activeSearchController) {
      await ctx.reply("Сейчас поиск не запущен.", { reply_markup: mainKeyboard });
      return;
    }
    activeSearchController.abort();
    await ctx.reply("Запрос на остановку принят. Текущий запрос Telegram завершится безопасно, после него новые имена проверяться не будут.", {
      reply_markup: mainKeyboard
    });
  };

  const startSearch = async (ctx: Context, raw: string, mode: SearchMode) => {
    if (!isOwner(ctx)) {
      await ctx.reply("Поиск доступен только владельцу в личном чате бота.", { reply_markup: mainKeyboard });
      return;
    }
    if (activeSearchController) {
      await ctx.reply("Поиск уже выполняется. Нажми «Остановить поиск», прежде чем запускать новый.", { reply_markup: mainKeyboard });
      return;
    }

    let args: ReturnType<typeof parseFindArguments>;
    try {
      args = parseFindArguments(raw, mode);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Некорректные параметры поиска.", {
        reply_markup: mainKeyboard
      });
      return;
    }

    const cooldown = await checker.getCooldownStatus();
    if (cooldown.waitSeconds > 0) {
      const until = new Date(cooldown.blockedUntil).toLocaleString();
      const hours = Math.floor(cooldown.waitSeconds / 3_600);
      const minutes = Math.floor((cooldown.waitSeconds % 3_600) / 60);
      await ctx.reply(
        "Telegram временно запретил новые проверки. UserFind ничего не отправляет в API до окончания паузы.\n"
          + "Осталось примерно: " + hours + " ч. " + minutes + " мин.\n"
          + "Повторная попытка будет доступна после: " + until,
        { reply_markup: mainKeyboard }
      );
      return;
    }

    const controller = new AbortController();
    activeSearchController = controller;
    setSearchActive(true);
    const chatId = ctx.chat!.id;
    let statusMessage: { message_id: number } | undefined;
    let lastEditAt = Date.now();

    try {
      statusMessage = await ctx.reply(
        [
          mode === "short" ? "Подготовка короткого поиска…" : "Подготовка обычного поиска…",
          "Диапазон: " + args.minLength + "–" + args.maxLength,
          "Приоритет: осмысленные слова, русская транслитерация, имена и фамилии.",
          "Время: до " + Math.round(config.searchDurationMs / 60_000) + " минут."
        ].join("\n")
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
          mode,
          signal: controller.signal
        },
        async (progress) => {
          if (Date.now() - lastEditAt < 25_000 || !statusMessage) return;
          try {
            await ctx.api.editMessageText(chatId, statusMessage.message_id, progressText(progress));
          } catch (error) {
            // A progress-message edit must never abort the MTProto scan.
            console.warn("Progress status update failed; continuing the search:", error);
          }
          lastEditAt = Date.now();
        }
      );

      const storageWarnings: string[] = [];
      try {
        await appendSearchHistory(summary);
      } catch (error) {
        console.error("Could not save search history:", error);
        storageWarnings.push("Историю поиска не удалось сохранить.");
      }

      let watchedCount = 0;
      try {
        watchedCount = await mergeWatchedCandidates(summary.occupiedCandidates, config.watchMaxEntries);
      } catch (error) {
        console.error("Could not update release watchlist:", error);
        storageWarnings.push("Список наблюдения не удалось обновить.");
      }

      const modeLabel = mode === "short" ? "Короткий поиск (5–6)" : "Обычный поиск (5–8 по умолчанию)";
      const lines = [
        "UserFind — поиск завершён",
        "",
        "Режим: " + modeLabel,
        "Проверено: " + summary.checked,
        "Подтверждённо свободны: " + summary.available,
        "Заняты: " + summary.occupied,
        "Требуют покупки (не бесплатные): " + summary.purchaseRequired,
        "Отклонены Telegram (invalid / reserved): " + summary.invalid,
        "Неизвестные ошибки: " + summary.unknown,
        "Вне Basic (4 символа): " + summary.notBasicLength,
        "Кандидатов сгенерировано: " + summary.candidatesGenerated,
        "Добавлено в список наблюдения: " + watchedCount,
        "Интервал перепроверки: " + Math.round(config.watchIntervalMs / 3_600_000) + " ч.",
        "Время: " + Math.round(summary.elapsedMs / 1000) + " сек."
      ];

      if (summary.stopReason === "telegram_flood_wait") {
        const cooldownStatus = await checker.getCooldownStatus();
        const until = cooldownStatus.blockedUntil
          ? new Date(cooldownStatus.blockedUntil).toLocaleString()
          : "время не определено";
        lines.push(
          "Остановлено по FLOOD_WAIT (" + summary.floodWaitSeconds + " сек.).",
          "Новые MTProto-проверки заблокированы до: " + until + ". Не перезапускай поиск до окончания паузы."
        );
      } else if (summary.stopReason === "telegram_error") {
        lines.push("Остановлено из-за ошибки Telegram: " + (summary.errorMessage ?? "неизвестная ошибка"));
      } else if (summary.stopReason === "time_budget_reached") {
        lines.push("Остановлено по ограничению времени.");
      } else if (summary.stopReason === "cancelled") {
        lines.push("Поиск остановлен владельцем.");
      } else {
        lines.push("Кандидаты закончились.");
      }

      if (storageWarnings.length) lines.push("", ...storageWarnings);

      if (summary.results.length) {
        lines.push("", "Лучшие результаты, подтверждённые Telegram как свободные:");
        summary.results.forEach((result, index) => {
          lines.push(
            "",
            (index + 1) + ". @" + result.username + " — качество " + result.score.total + "/100",
            "Тип: " + sourceLabel(result.source) + " | проверено: " + result.checkedAt,
            "https://t.me/" + result.username
          );
        });
        lines.push("", "Проверка не резервирует имя. Статус может измениться сразу после ответа Telegram.");
      } else {
        lines.push("", "В этом запуске не подтверждено ни одного свободного Basic username. Неизвестные и платные варианты не считаются свободными.");
      }

      const chunks = splitTelegramText(lines.join("\n"));
      if (statusMessage) {
        try {
          await ctx.api.editMessageText(chatId, statusMessage.message_id, chunks[0]!);
        } catch (editError) {
          console.error("Could not edit search status message; sending a new message:", editError);
          await ctx.api.sendMessage(chatId, chunks[0]!, { reply_markup: mainKeyboard });
        }
      } else {
        await ctx.api.sendMessage(chatId, chunks[0]!, { reply_markup: mainKeyboard });
      }
      for (const chunk of chunks.slice(1)) {
        await ctx.api.sendMessage(chatId, chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Search failed:", error);
      // Do not try to edit the status message here: it may be immutable for
      // Telegram-side reasons. Always deliver the original failure separately.
      try {
        await ctx.api.sendMessage(chatId, "Ошибка поиска: " + message, { reply_markup: mainKeyboard });
      } catch (deliveryError) {
        console.error("Could not send search error to owner:", deliveryError);
      }
    } finally {
      if (activeSearchController === controller) {
        activeSearchController = null;
        setSearchActive(false);
      }
    }
  };

  const checkOneUsername = async (ctx: Context, raw: string) => {
    if (isSearchActive()) {
      await ctx.reply("Сначала дождись окончания поиска или нажми «Остановить поиск». Ручная проверка не будет вставать в очередь рядом со сканированием.", {
        reply_markup: mainKeyboard
      });
      return;
    }
    if (!isOwner(ctx)) {
      await ctx.reply("Проверка имени доступна только владельцу в личном чате бота.", { reply_markup: mainKeyboard });
      return;
    }
    const username = raw.trim();
    if (!username) {
      await ctx.reply("Отправь username без ссылки, например pavel или dobro.", { reply_markup: mainKeyboard });
      return;
    }
    try {
      const result = await checker.check(username);
      await ctx.reply(
        "@" + result.username + "\n"
          + formatStatus(result.status) + "\n"
          + result.detail + "\n"
          + "Проверено: " + result.checkedAt,
        { reply_markup: mainKeyboard }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply("Проверка остановлена: " + message, { reply_markup: mainKeyboard });
    }
  };

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "UserFind — поиск коротких и осмысленных Telegram username.",
        "",
        "Используй кнопки под полем ввода: обычный поиск, короткий поиск, проверка одного имени и список наблюдения.",
        "",
        "Свободными считаются только имена, подтверждённые Telegram. Неизвестные и требующие покупки варианты исключаются."
      ].join("\n"),
      { reply_markup: mainKeyboard }
    );
  });

  bot.command("id", async (ctx) => {
    await ctx.reply("Твой Telegram user ID: " + String(ctx.from?.id ?? "unknown"), {
      reply_markup: mainKeyboard
    });
  });

  bot.command("help", showHelp);
  bot.command("menu", async (ctx) => {
    await ctx.reply("Меню UserFind:", { reply_markup: mainKeyboard });
  });
  bot.command("four", async (ctx) => {
    await ctx.reply(fourCharacterInfo, { reply_markup: mainKeyboard });
  });
  bot.command("find", async (ctx) => {
    await startSearch(ctx, String(ctx.match ?? ""), "standard");
  });
  bot.command("short", async (ctx) => {
    await startSearch(ctx, String(ctx.match ?? ""), "short");
  });

  bot.command("watchlist", showWatchlist);

  bot.command("unwatch", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("Эта команда доступна только владельцу в личном чате.", { reply_markup: mainKeyboard });
      return;
    }
    const username = String(ctx.match ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!username) {
      await ctx.reply("Укажи имя: /unwatch username", { reply_markup: mainKeyboard });
      return;
    }
    const removed = await removeWatchedUsername(username);
    await ctx.reply(
      removed ? "@" + username + " удалён из списка наблюдения." : "@" + username + " не найден в списке.",
      { reply_markup: mainKeyboard }
    );
  });

  bot.command("check", async (ctx) => {
    await checkOneUsername(ctx, String(ctx.match ?? ""));
  });

  bot.command("cancel", cancelSearch);

  // Reply-keyboard buttons: no slash commands are required for normal use.
  bot.hears("🔎 Обычный поиск", async (ctx) => startSearch(ctx, "", "standard"));
  bot.hears("⚡ Короткие 5–6", async (ctx) => startSearch(ctx, "", "short"));
  bot.hears("4️⃣ Четыре символа", async (ctx) => {
    await ctx.reply(fourCharacterInfo, { reply_markup: mainKeyboard });
  });
  bot.hears("👁 Список наблюдения", showWatchlist);
  bot.hears("🛑 Остановить поиск", cancelSearch);
  bot.hears("🆔 Мой ID", async (ctx) => {
    await ctx.reply("Твой Telegram user ID: " + String(ctx.from?.id ?? "unknown"), {
      reply_markup: mainKeyboard
    });
  });
  bot.hears("ℹ️ Помощь", showHelp);
  bot.hears("✅ Проверить имя", async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.reply("Проверка имени доступна только владельцу в личном чате.", { reply_markup: mainKeyboard });
      return;
    }
    pendingUsernameChecks.add(ctx.from!.id);
    await ctx.reply("Отправь одно имя отдельным сообщением, например: pavel, durov, erik, dobro или sokol.", {
      reply_markup: mainKeyboard
    });
  });

  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !pendingUsernameChecks.has(userId)) {
      await next();
      return;
    }
    pendingUsernameChecks.delete(userId);
    if (!isOwner(ctx)) {
      await ctx.reply("Проверка имени доступна только владельцу в личном чате.", { reply_markup: mainKeyboard });
      return;
    }
    await checkOneUsername(ctx, ctx.message.text);
  });

  bot.catch((error) => {
    console.error("Bot update error:", error.error);
  });

  return bot;
}

export async function startBot(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Start UserFind" },
    { command: "menu", description: "Show the keyboard menu" },
    { command: "find", description: "Standard search for free usernames" },
    { command: "short", description: "Short meaningful usernames (5–6)" },
    { command: "four", description: "Why four-character names are not Basic" },
    { command: "check", description: "Check one username" },
    { command: "cancel", description: "Cancel the active search" },
    { command: "watchlist", description: "Show watched occupied usernames" },
    { command: "unwatch", description: "Remove a username from monitoring" },
    { command: "id", description: "Show your numeric Telegram user ID" },
    { command: "help", description: "Show help" }
  ]);

  await bot.start({
    onStart: (botInfo) => console.log("UserFind bot started as @" + botInfo.username)
  });
}
