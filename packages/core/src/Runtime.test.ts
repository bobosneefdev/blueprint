import { expect, test } from "bun:test";
import { Validate } from "@better-rust/dsl";
import type { Plugin } from "@better-rust/dsl";
import { Engine } from "@better-rust/dsl";
import { initialState, Input, parseCommand, step } from "./Runtime.ts";

const starter = async (name: string): Promise<Plugin> => {
  const r = Validate.validate(
    await Bun.file(new URL(`../../dsl/starter/${name}.json`, import.meta.url)).json(),
  );

  if (!r.ok) throw new Error(JSON.stringify(r.problems));

  return r.plugin;
};

const world = (now: number, over = {}) => ({ ...Validate.emptyWorld, now, ...over });

test("parseCommand", () => {
  expect(parseCommand("/Pop 10 big bob")).toEqual(["pop", ["10", "big", "bob"]]);
  expect(parseCommand("hello /pop")).toBeUndefined();
});

test("schedule respects everySeconds and plugin state persists across ticks", async () => {
  const afk = await starter("afk-alert");
  const plugins = [{ plugin: afk, enabled: true }];
  const state = initialState();

  const team = [
    {
      steamId: "1",
      name: "Bob",
      x: 0,
      y: 0,
      online: true,
      alive: true,
      spawnTime: 0,
      deathTime: 0,
      lastMovedAt: 0,
    },
  ];

  const chats = (now: number) =>
    step(plugins, Input.Tick({ world: world(now, { team }) }), state).outputs.flatMap((o) =>
      o.effects.flatMap((e) => (Engine.Effect_.$is("TeamChat")(e) ? [e.text] : [])),
    );

  expect(chats(700)).toEqual(["Bob looks AFK (11 min)"]);
  expect(chats(730)).toEqual([]); // < everySeconds since last run
  expect(chats(800)).toEqual([]); // already alerted (state persisted)
});

test("event filter and chat budget", async () => {
  const cargo = await starter("cargo-alert");
  const plugins = [{ plugin: cargo, enabled: true }];
  const state = initialState();

  const appear = (id: string, kind: string) =>
    Input.Event({
      world: world(100),
      event: { kind: "markerAppeared", payload: { id, kind, x: 0.0, y: 0.0, name: "" } },
    });

  expect(step(plugins, appear("1", "chinook"), state).outputs).toEqual([]);

  const runs = ["2", "3", "4"].map(
    (id) => step(plugins, appear(id, "cargoShip"), state).outputs[0],
  );

  expect(runs.map((o) => [o?.effects.length, o?.throttled])).toEqual([
    [1, 0],
    [1, 0],
    [0, 1],
  ]);
});

test("per-player command rate limit", async () => {
  const pop = await starter("pop");
  const state = initialState();

  const ask = (steamId: string, now: number) =>
    step(
      [{ plugin: pop, enabled: true }],
      Input.Chat({ world: world(now), steamId, name: "x", text: "/pop" }),
      state,
    ).outputs.length;

  const spam = [0, 1, 2, 3, 4, 5, 6].map((t) => ask("1", t));

  expect(spam).toEqual([1, 1, 1, 1, 1, 0, 0]);
  expect(ask("2", 7)).toBe(1);
  expect(ask("1", 61)).toBe(1);
});
