// Per-server plugin runtime: routes ticks, events and chat commands to plugins, enforces chat
// budgets, and hands effects to a sink. Stateless apart from per-plugin state + budget windows,
// so the same code drives live servers and `bot dry-run` replay.
import { Cel, Engine, type Plugin, Trigger, type ValueMap, type World } from "@better-rust/dsl";
import { Data, Result } from "effect";
import type { Event } from "./Snapshot.ts";

export interface Installed {
  readonly plugin: Plugin;
  readonly enabled: boolean;
}

export type Input = Data.TaggedEnum<{
  Tick: { readonly world: World };
  Event: { readonly world: World; readonly event: Event };
  Chat: {
    readonly world: World;
    readonly steamId: string;
    readonly name: string;
    readonly text: string;
  };
}>;

export const Input = Data.taggedEnum<Input>();

type Selected = Data.TaggedEnum<{
  Run: { readonly plugin: Plugin; readonly event: ValueMap; readonly args: ValueMap };
  Reply: { readonly plugin: Plugin; readonly text: string };
}>;

const Selected = Data.taggedEnum<Selected>();

export interface Output {
  readonly plugin: string;
  readonly effects: ReadonlyArray<Engine.Effect_>;
  /** TeamChat effects dropped because the plugin hit its chatBudget. */
  readonly throttled: number;
}

export interface Failure {
  readonly plugin: string;
  readonly at: string;
  readonly message: string;
}

/** Splits "/afk 10 bob" into ["afk", "10", "bob"]. Returns undefined for non-commands. */
export const parseCommand = (
  text: string,
): readonly [string, ReadonlyArray<string>] | undefined => {
  const m = /^\/([a-z][a-z0-9-]*)\s*(.*)$/i.exec(text.trim());

  if (!m?.[1]) return undefined;

  return [m[1].toLowerCase(), (m[2] ?? "").split(/\s+/).filter((s) => s.length > 0)];
};

const commandOf = (t: Trigger) =>
  Trigger.guards.Command(t) || Trigger.guards.CommandAndSchedule(t) ? t : undefined;

const everyOf = (t: Trigger) =>
  Trigger.guards.Schedule(t) || Trigger.guards.CommandAndSchedule(t) ? t.everySeconds : undefined;

/** Maps positional words onto declared args. Numbers are parsed; missing required args fail. */
const bindArgs = (
  plugin: Plugin,
  words: ReadonlyArray<string>,
): Result.Result<ValueMap, string> => {
  const cmd = commandOf(plugin.trigger);
  const out: Record<string, string | number> = {};

  for (const [i, arg] of (cmd?.args ?? []).entries()) {
    const word = arg.name === cmd?.args.at(-1)?.name ? words.slice(i).join(" ") : words[i];

    if (word === undefined || word === "") {
      if (arg.optional) continue;

      const usage = cmd?.args.map((a) => (a.optional ? `[${a.name}]` : a.name)).join(" ");

      return Result.fail(`usage: /${cmd?.name} ${usage}`);
    }

    const n = Number(word);

    if (arg.type === "number" && Number.isNaN(n))
      return Result.fail(`${arg.name} must be a number`);

    out[arg.name] = arg.type === "number" ? n : word;
  }

  return Result.succeed(out);
};

export interface State {
  readonly pluginState: Map<string, ValueMap>;
  readonly lastRun: Map<string, number>;
  /** Unix seconds of each chat message sent, per plugin, for the rolling one-minute budget. */
  readonly chatLog: Map<string, number[]>;
}

export const initialState = (): State => ({
  pluginState: new Map(),
  lastRun: new Map(),
  chatLog: new Map(),
});

/** Which plugins fire for this input, with which event/args. */
const select = (plugins: ReadonlyArray<Installed>, input: Input, state: State): Selected[] => {
  const enabled = plugins.flatMap((p) => (p.enabled ? [p.plugin] : []));

  return Input.$match(input, {
    Tick: ({ world }) =>
      enabled.flatMap((plugin) => {
        const every = everyOf(plugin.trigger);
        const last = state.lastRun.get(plugin.name) ?? 0;

        return every !== undefined && world.now - last >= every
          ? [Selected.Run({ plugin, event: {}, args: {} })]
          : [];
      }),
    Event: ({ event }) =>
      enabled.flatMap((plugin) =>
        Trigger.guards.Event(plugin.trigger) && plugin.trigger.kind === event.kind
          ? [Selected.Run({ plugin, event: event.payload, args: {} })]
          : [],
      ),
    Chat: (chat) => {
      const parsed = parseCommand(chat.text);

      if (!parsed) return [];

      const [name, words] = parsed;
      const plugin = enabled.find((p) => commandOf(p.trigger)?.name === name);

      if (!plugin) return [];

      const event = { steamId: chat.steamId, name: chat.name, text: chat.text };

      return [
        Result.match(bindArgs(plugin, words), {
          onSuccess: (args) => Selected.Run({ plugin, event, args }),
          onFailure: (text) => Selected.Reply({ plugin, text }),
        }),
      ];
    },
  });
};

/** Event filters are CEL; evaluated here so non-matching plugins never run. */
const passesFilter = (plugin: Plugin, world: World, event: ValueMap, state: ValueMap): boolean =>
  !Trigger.guards.Event(plugin.trigger) ||
  plugin.trigger.filter === undefined ||
  Cel.evaluate(plugin.trigger.filter, { world, event, state, args: {} }) === true;

const budget = (
  plugin: Plugin,
  now: number,
  state: State,
  effects: ReadonlyArray<Engine.Effect_>,
) => {
  const log = (state.chatLog.get(plugin.name) ?? []).filter((t) => now - t < 60);
  const kept: Engine.Effect_[] = [];
  let throttled = 0;

  for (const e of effects) {
    if (!Engine.Effect_.$is("TeamChat")(e)) {
      kept.push(e);
      continue;
    }

    if (log.length >= plugin.chatBudget) {
      throttled++;
      continue;
    }

    log.push(now);
    kept.push(e);
  }

  state.chatLog.set(plugin.name, log);

  return { kept, throttled };
};

export interface StepResult {
  readonly outputs: ReadonlyArray<Output>;
  readonly failures: ReadonlyArray<Failure>;
}

const runOne = (input: Input, state: State, plugin: Plugin, event: ValueMap, args: ValueMap) => {
  const pluginState = state.pluginState.get(plugin.name) ?? plugin.state;
  const { world } = input;

  try {
    if (!passesFilter(plugin, world, event, pluginState)) return undefined;

    const r = Engine.run({ plugin, world, event, state: pluginState, args });
    const { kept, throttled } = budget(plugin, world.now, state, r.effects);

    state.pluginState.set(plugin.name, r.state);
    state.lastRun.set(plugin.name, world.now);

    return Result.succeed({ plugin: plugin.name, effects: kept, throttled });
  } catch (e) {
    state.lastRun.set(plugin.name, world.now);

    return Result.fail(
      e instanceof Engine.EvalError
        ? { plugin: plugin.name, at: e.at, message: e.message }
        : { plugin: plugin.name, at: "", message: String(e) },
    );
  }
};

/** Runs one input through every matching plugin. Failures are reported, never thrown. */
export const step = (plugins: ReadonlyArray<Installed>, input: Input, state: State): StepResult => {
  const outputs: Output[] = [];
  const failures: Failure[] = [];

  for (const sel of select(plugins, input, state)) {
    const r = Selected.$match(sel, {
      Reply: ({ plugin, text }) =>
        Result.succeed({
          plugin: plugin.name,
          effects: [Engine.Effect_.TeamChat({ text })],
          throttled: 0,
        }),
      Run: ({ plugin, event, args }) => runOne(input, state, plugin, event, args),
    });

    if (r === undefined) continue;

    if (Result.isSuccess(r)) outputs.push(r.success);
    else failures.push(r.failure);
  }

  return { outputs, failures };
};
