#!/usr/bin/env bun
// `bot`: the agent's interface to better-rust. Runs inside the WSL sandbox.
//
// Offline (no bot needed): schema, validate, items, raid.
// Live (talks to the Windows bot over localhost RPC): team, markers, info, dry-run, propose.
// Output is compact JSON on stdout so agents can read it directly.
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Validate } from "@better-rust/dsl";
import { Config, Console, Effect, Option, Redacted, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Items from "./Items.ts";

const dataDir = Config.String("BOT_DATA_DIR").pipe(
  Config.withDefault("/data/rust-items-json/data"),
);

const rpcUrl = Config.String("BOT_RPC_URL").pipe(Config.withDefault("http://127.0.0.1:47615"));

const rpcToken = Config.Redacted("BOT_RPC_TOKEN");

/** Everything the CLI prints. All of it is plain data that JSON.stringify handles. */
type Output =
  | ReturnType<typeof Validate.jsonSchema>
  | { readonly ok: true; readonly testsPassed: number }
  | { readonly ok: false; readonly problems: ReadonlyArray<Validate.Problem> }
  | ReadonlyArray<Items.Item>
  | ReturnType<typeof Items.raidCosts>;

const print = (v: Output) => Console.log(JSON.stringify(v, null, 1));

const readJson = (path: string) =>
  Effect.tryPromise({
    try: async (): Promise<Schema.Json> => Bun.file(path).json(),
    catch: (e) => `cannot read ${path}: ${String(e)}`,
  });

const schema = Command.make("schema", {}, () => print(Validate.jsonSchema())).pipe(
  Command.withDescription("Print the plugin JSON Schema"),
);

const validate = Command.make("validate", { file: Argument.String("plugin.json") }, ({ file }) =>
  Effect.gen(function* () {
    const r = Validate.validate(yield* readJson(file));

    yield* print(r.ok ? { ok: true, testsPassed: r.passed } : { ok: false, problems: r.problems });

    if (!r.ok) process.exitCode = 1;
  }),
).pipe(Command.withDescription("Schema + CEL type check + fixture tests"));

const items = Command.make(
  "items",
  { query: Argument.String("query"), limit: Flag.Int("limit").pipe(Flag.withDefault(5)) },
  ({ query, limit }) =>
    Effect.gen(function* () {
      const all = yield* Effect.promise(async () =>
        Items.loadItems(await Effect.runPromise(dataDir)),
      );

      yield* print(Items.search(all, query, limit));
    }),
).pipe(Command.withDescription("Search items: crafting, recycling, stack size"));

const raid = Command.make("raid", { target: Argument.String("target") }, ({ target }) =>
  Effect.gen(function* () {
    const dir = yield* dataDir;

    const [all, costs] = yield* Effect.promise(() =>
      Promise.all([Items.loadItems(dir), Items.loadRaid(dir)]),
    );

    yield* print(Items.raidCosts(costs, all, target));
  }),
).pipe(Command.withDescription("Explosives needed per target, e.g. 'stone wall'"));

/** Live data and actions live in the Windows bot; the CLI is a thin authenticated client. */
const rpc = (path: string, body?: Schema.Json) =>
  Effect.gen(function* () {
    const url = yield* rpcUrl;
    const token = yield* rpcToken;

    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${Redacted.value(token)}`,
        "content-type": "application/json",
      },
    };

    if (body !== undefined) init.body = JSON.stringify(body);

    const res = yield* Effect.tryPromise({
      try: () => fetch(`${url}${path}`, init),
      catch: (e) => `bot unreachable at ${url}: ${String(e)}`,
    });

    const text = yield* Effect.promise(() => res.text());

    if (!res.ok) return yield* Effect.fail(`bot ${res.status}: ${text}`);

    yield* Console.log(text);
  });

const live = (name: string, description: string) =>
  Command.make(name, { server: Flag.String("server").pipe(Flag.optional) }, ({ server }) =>
    rpc(
      `/v1/${name}${Option.match(server, { onNone: () => "", onSome: (s) => `?server=${encodeURIComponent(s)}` })}`,
    ),
  ).pipe(Command.withDescription(description));

const dryRun = Command.make(
  "dry-run",
  { file: Argument.String("plugin.json"), from: Flag.String("from").pipe(Flag.withDefault("2h")) },
  ({ file, from }) =>
    Effect.gen(function* () {
      yield* rpc("/v1/dry-run", { plugin: yield* readJson(file), from });
    }),
).pipe(
  Command.withDescription("Replay recorded server data through a plugin; report what would fire"),
);

const propose = Command.make("propose", { file: Argument.String("plugin.json") }, ({ file }) =>
  Effect.gen(function* () {
    yield* rpc("/v1/propose", { plugin: yield* readJson(file) });
  }),
).pipe(Command.withDescription("Ask the requester to confirm activation in team chat"));

const bot = Command.make("bot").pipe(
  Command.withDescription("better-rust agent tools"),
  Command.withSubcommands([
    schema,
    validate,
    items,
    raid,
    live("team", "Team members: position, online, alive, lastMovedAt"),
    live("markers", "Map markers: cargo, heli, chinook, vending, crates"),
    live("info", "Server info and in-game time"),
    live("devices", "Paired smart devices and their bindings"),
    dryRun,
    propose,
  ]),
);

Command.run(bot, { version: "0.1.0" }).pipe(
  Effect.catch((e) =>
    Console.error(String(e)).pipe(Effect.andThen(Effect.sync(() => (process.exitCode = 1)))),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
