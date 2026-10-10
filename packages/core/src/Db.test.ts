import { expect, test } from "bun:test";
import * as Db from "./Db.ts";

test("recordings round-trip compressed, ordered, pruned", () => {
  const db = Db.open(":memory:");
  const big = JSON.stringify({ team: Array.from({ length: 50 }, (_, i) => ({ name: `p${i}` })) });

  Db.record(db, "s1", 100, "world", big);
  Db.record(db, "s1", 50, "event", '{"kind":"wipe"}');
  Db.record(db, "s2", 100, "world", "{}");

  expect(Db.recorded(db, "s1", 0).map((r) => [r.at, r.kind])).toEqual([
    [50, "event"],
    [100, "world"],
  ]);
  expect(Db.recorded(db, "s1", 0)[1]?.json).toBe(big);

  Db.prune(db, "s1", 50 + 7 * 24 * 3600 + 1);
  expect(Db.recorded(db, "s1", 0).map((r) => r.at)).toEqual([100]);

  Db.wipeRecordings(db, "s1");
  expect(Db.recorded(db, "s1", 0)).toEqual([]);
  expect(Db.recorded(db, "s2", 0).length).toBe(1);
});
