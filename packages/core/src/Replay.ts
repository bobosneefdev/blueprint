// `bot dry-run`: feed recorded worlds/events through the runtime for one plugin and report what
// would have fired. Same Runtime.step as live, so results match production behaviour.
import { Engine, type Plugin, World } from "@blueprint/dsl";
import { Match, Schema } from "effect";
import * as Runtime from "./Runtime.ts";
import { Event } from "./Snapshot.ts";

export interface Recorded {
  readonly at: number;
  readonly kind: "world" | "event" | "chat";
  readonly json: string;
}

export interface Fired {
  readonly at: number;
  readonly trigger: string;
  readonly effects: ReadonlyArray<string>;
  readonly throttled: number;
}

export interface Report {
  readonly frames: number;
  readonly from: number;
  readonly to: number;
  readonly fired: ReadonlyArray<Fired>;
  readonly failures: ReadonlyArray<Runtime.Failure>;
}

const decodeWorld = Schema.decodeUnknownSync(Schema.fromJsonString(World));

const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(Event));

const Chat = Schema.Struct({ steamId: Schema.String, name: Schema.String, text: Schema.String });

const decodeChat = Schema.decodeUnknownSync(Schema.fromJsonString(Chat));

const describe = (e: Engine.Effect_) =>
  Engine.Effect_.$match(e, {
    TeamChat: (a) => `chat: ${a.text}`,
    Notify: (a) => `notify(${a.channel}): ${a.text}`,
    SmartSwitch: (a) => `switch ${a.binding} ${a.on ? "on" : "off"}`,
    SetState: (a) => `state ${a.key} = ${JSON.stringify(a.value)}`,
  });

const toInput = (f: Recorded, world: World) =>
  Match.value(f.kind).pipe(
    Match.when("world", () => Runtime.Input.Tick({ world })),
    Match.when("event", () => Runtime.Input.Event({ world, event: decodeEvent(f.json) })),
    Match.when("chat", () => Runtime.Input.Chat({ world, ...decodeChat(f.json) })),
    Match.exhaustive,
  );

/** Each world frame is a Tick; events and chats run against the latest world seen. */
export const replay = (plugin: Plugin, frames: ReadonlyArray<Recorded>): Report => {
  const plugins = [{ plugin, enabled: true }];
  const state = Runtime.initialState();
  const fired: Fired[] = [];
  const failures: Runtime.Failure[] = [];
  let world: World | undefined;

  for (const f of frames) {
    if (f.kind === "world") world = decodeWorld(f.json);

    if (world === undefined) continue;

    const input = toInput(f, world);

    const r = Runtime.step(plugins, input, state);

    failures.push(...r.failures);

    for (const o of r.outputs)
      if (o.effects.length > 0 || o.throttled > 0)
        fired.push({
          at: f.at,
          trigger: input._tag,
          effects: o.effects.map(describe),
          throttled: o.throttled,
        });
  }

  return {
    frames: frames.length,
    from: frames[0]?.at ?? 0,
    to: frames.at(-1)?.at ?? 0,
    fired,
    failures,
  };
};
