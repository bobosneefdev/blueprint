import { expect, test } from "bun:test";
import { Validate } from "@better-rust/dsl";
import { replay } from "./Replay.ts";

test("replays recorded worlds and events through a plugin", async () => {
  const r = Validate.validate(
    await Bun.file(new URL("../../dsl/starter/afk-alert.json", import.meta.url)).json(),
  );

  if (!r.ok) throw new Error("starter invalid");

  const member = (lastMovedAt: number) => ({
    steamId: "1",
    name: "Bob",
    x: 0,
    y: 0,
    online: true,
    alive: true,
    spawnTime: 0,
    deathTime: 0,
    lastMovedAt,
  });

  const world = (now: number) => JSON.stringify({ ...Validate.emptyWorld, now, team: [member(0)] });

  const report = replay(r.plugin, [
    { at: 300, kind: "world", json: world(300) },
    { at: 700, kind: "world", json: world(700) },
    { at: 800, kind: "world", json: world(800) },
    { at: 810, kind: "event", json: JSON.stringify({ kind: "wipe", payload: {} }) },
  ]);

  expect(report.failures).toEqual([]);
  expect(report.fired.map((f) => [f.at, f.effects[0]])).toEqual([
    [300, "state alerted = []"],
    [700, "chat: Bob looks AFK (11 min)"],
    [800, 'state alerted = ["1"]'],
  ]);
});
