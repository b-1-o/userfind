import { afterEach, describe, expect, it } from "vitest";
import {
  mergeWatchedCandidates,
  readWatchlist,
  removeWatchedUsername
} from "../src/storage/watch-store.js";

const testUsername = "userfindtest";

afterEach(async () => {
  await removeWatchedUsername(testUsername);
});

describe("watch store", () => {
  it("stores and reads occupied candidates for release monitoring", async () => {
    const count = await mergeWatchedCandidates(
      [{
        username: testUsername,
        source: "dictionary",
        score: {
          total: 91,
          lexical: 100,
          pronunciation: 90,
          visual: 88,
          rarity: 94,
          brandability: 90
        }
      }],
      150
    );

    const entries = await readWatchlist();
    const entry = entries.find((item) => item.username === testUsername);

    expect(count).toBeGreaterThan(0);
    expect(entry?.score).toBe(91);
    expect(entry?.source).toBe("dictionary");
  });
});