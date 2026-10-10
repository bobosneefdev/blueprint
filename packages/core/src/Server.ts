// One paired Rust server: polls Rust+ on a fixed cadence (one request per data source, shared by
// every plugin), records frames, turns diffs + broadcasts into runtime inputs, and executes the
// resulting effects. Lives for the scope; reconnect is the caller's retry policy.
import { type Device, Engine, type World } from "@better-rust/dsl";
import { Effect, Ref, Schedule, Stream, SubscriptionRef } from "effect";
import * as Db from "./Db.ts";
import * as Runtime from "./Runtime.ts";
import type * as RustPlus from "./RustPlus.ts";
import * as Snapshot from "./Snapshot.ts";

export interface Binding {
  readonly name: string;
  readonly entityId: number;
  readonly kind: Device["kind"];
}

export interface Options {
  readonly serverId: string;
  readonly db: Db.Db;
  readonly rp: RustPlus.Interface;
  readonly plugins: Ref.Ref<ReadonlyArray<Runtime.Installed>>;
  readonly bindings: Ref.Ref<ReadonlyArray<Binding>>;
  /** Team chat lines starting with this prefix (e.g. "@bot") go to the agent, not plugins. */
  readonly onAgentMessage: (steamId: string, name: string, text: string) => Effect.Effect<void>;
  readonly notify: (text: string, channel: "toast" | "phone" | "both") => Effect.Effect<void>;
  readonly isAgentMessage: (text: string) => boolean;
  /** Our own chat lines echo back as broadcasts; skip them so plugins never react to the bot. */
  readonly botPrefix: string;
  readonly pollSeconds?: number;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export const run = (opts: Options) =>
  Effect.gen(function* () {
    const { rp, db, serverId } = opts;
    const state = Runtime.initialState();
    const world = yield* SubscriptionRef.make<World | undefined>(undefined);

    const execute = Effect.fn("Server.execute")(function* (effects: ReadonlyArray<Engine.Effect_>) {
      const bindings = yield* Ref.get(opts.bindings);

      const perform = (e: Engine.Effect_) =>
        Engine.Effect_.$match(e, {
          TeamChat: ({ text }) =>
            rp.request("sendTeamMessage", { message: `${opts.botPrefix}${text}`.slice(0, 128) }),
          SmartSwitch: ({ binding, on }) => {
            const b = bindings.find((x) => x.name === binding);

            return b === undefined
              ? Effect.void
              : rp.request("setEntityValue", { entityId: b.entityId, value: on });
          },
          Notify: ({ text, channel }) => opts.notify(text, channel),
          SetState: () => Effect.void,
        });

      for (const e of effects) yield* Effect.ignore(perform(e));
    });

    const feed = Effect.fn("Server.feed")(function* (input: Runtime.Input) {
      const plugins = yield* Ref.get(opts.plugins);
      const r = Runtime.step(plugins, input, state);

      for (const f of r.failures) yield* Effect.logWarning("plugin failed", f);

      for (const o of r.outputs) yield* execute(o.effects);
    });

    const devices = Effect.fn("Server.devices")(function* () {
      const bindings = yield* Ref.get(opts.bindings);

      return yield* Effect.forEach(bindings, (b) =>
        rp.request("getEntityInfo", { entityId: b.entityId }).pipe(
          Effect.map((r): Device => ({
            binding: b.name,
            kind: b.kind,
            value: r.entityInfo?.payload?.value ?? false,
          })),
          Effect.orElseSucceed((): Device => ({ binding: b.name, kind: b.kind, value: false })),
        ),
      );
    });

    const poll = Effect.gen(function* () {
      const [info, time, team, markers, devs] = yield* Effect.all([
        rp.request("getInfo"),
        rp.request("getTime"),
        rp.request("getTeamInfo"),
        rp.request("getMapMarkers"),
        devices(),
      ]);

      const prev = yield* SubscriptionRef.get(world);

      const next = Snapshot.toWorld(
        {
          now: nowSeconds(),
          info: info.info ?? {},
          time: time.time ?? {},
          team: team.teamInfo ?? {},
          markers: markers.mapMarkers?.markers ?? [],
          devices: devs,
        },
        prev,
      );

      yield* SubscriptionRef.set(world, next);
      Db.record(db, serverId, next.now, "world", JSON.stringify(next));

      if (prev !== undefined)
        for (const event of Snapshot.diff(prev, next)) {
          Db.record(db, serverId, next.now, "event", JSON.stringify(event));

          if (event.kind === "wipe") Db.wipeRecordings(db, serverId);

          yield* feed(Runtime.Input.Event({ world: next, event }));
        }

      yield* feed(Runtime.Input.Tick({ world: next }));
      Db.prune(db, serverId, next.now);
    }).pipe(
      Effect.tapError((e) => Effect.logWarning("poll failed", e)),
      Effect.ignore,
    );

    const onBroadcast = Effect.fn("Server.broadcast")(function* (b: RustPlus.AppBroadcast) {
      const current = yield* SubscriptionRef.get(world);

      if (current === undefined) return;

      const msg = b.teamMessage?.message;

      if (msg?.message !== undefined && !msg.message.startsWith(opts.botPrefix)) {
        const chat = { steamId: msg.steamId ?? "", name: msg.name ?? "", text: msg.message };

        Db.record(db, serverId, current.now, "chat", JSON.stringify(chat));

        if (opts.isAgentMessage(chat.text))
          return yield* opts.onAgentMessage(chat.steamId, chat.name, chat.text);

        yield* feed(
          Runtime.Input.Event({ world: current, event: { kind: "teamChat", payload: chat } }),
        );
        yield* feed(Runtime.Input.Chat({ world: current, ...chat }));
      }

      const changed = b.entityChanged;

      if (changed?.entityId !== undefined) {
        const bindings = yield* Ref.get(opts.bindings);
        const binding = bindings.find((x) => x.entityId === changed.entityId);

        if (binding)
          yield* feed(
            Runtime.Input.Event({
              world: current,
              event: {
                kind: "deviceChanged",
                payload: {
                  binding: binding.name,
                  kind: binding.kind,
                  value: changed.payload?.value ?? false,
                },
              },
            }),
          );
      }
    });

    yield* rp.broadcasts.pipe(Stream.runForEach(onBroadcast), Effect.forkScoped);
    yield* poll.pipe(
      Effect.repeat(Schedule.spaced(`${opts.pollSeconds ?? 10} seconds`)),
      Effect.forkScoped,
    );

    return { world: SubscriptionRef.changes(world), current: SubscriptionRef.get(world) };
  });
