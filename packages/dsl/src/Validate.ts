// `bot validate`: schema decode -> static checks on every expression -> fixture tests.
// Returns every problem at once so the agent can fix them in one pass.
import { Exit, Schema } from "effect";
import * as Cel from "./Cel.ts";
import * as Engine from "./Engine.ts";
import {
  Action,
  EventPayloads,
  Expected,
  type Fixture,
  type FixtureWorld,
  Plugin,
  Trigger,
} from "./Plugin.ts";
import type { World } from "./World.ts";

export interface Problem {
  readonly path: string;
  readonly message: string;
}

export type Result =
  | { readonly ok: true; readonly plugin: Plugin; readonly passed: number }
  | { readonly ok: false; readonly problems: ReadonlyArray<Problem> };

export const emptyWorld: World = {
  now: 0,
  server: { name: "test", mapSize: 4500, wipeTime: 0, players: 0, maxPlayers: 0, queued: 0 },
  time: { hour: 12, sunrise: 7, sunset: 20, isDay: true },
  team: [],
  markers: [],
  devices: [],
};

/** Fixtures state only what matters; everything else gets a neutral default. */
const fixtureWorld = (w: FixtureWorld): World => ({
  now: w.now ?? emptyWorld.now,
  server: { ...emptyWorld.server, ...w.server },
  time: { ...emptyWorld.time, ...w.time },
  team: (w.team ?? []).map((m) => ({
    name: "player",
    x: 0,
    y: 0,
    online: true,
    alive: true,
    spawnTime: 0,
    deathTime: 0,
    lastMovedAt: 0,
    ...m,
  })),
  markers: (w.markers ?? []).map((m) => ({ id: "0", x: 0, y: 0, name: "", ...m })),
  devices: w.devices ?? [],
});

type Located = readonly [path: string, expr: string];

const textExprs = (at: string, text: string): Located[] =>
  Cel.templateExprs(text).map((e) => [`${at}.text`, e]);

const actionExprs = (at: string, a: Action): Located[] =>
  Action.match(a, {
    TeamChat: (x) => textExprs(at, x.text),
    Notify: (x) => textExprs(at, x.text),
    SmartSwitch: (x) => [[`${at}.on`, x.on]],
    SetState: (x) => [[`${at}.value`, x.value]],
  });

const exprsOf = (plugin: Plugin): Located[] => {
  const out: Located[] = [];

  if (Trigger.guards.Event(plugin.trigger) && plugin.trigger.filter !== undefined)
    out.push(["trigger.filter", plugin.trigger.filter]);

  for (const [i, step] of plugin.steps.entries()) {
    if (step.when !== undefined) out.push([`steps[${i}].when`, step.when]);

    if (step.each !== undefined) out.push([`steps[${i}].each`, step.each]);

    for (const [j, a] of step.actions.entries())
      out.push(...actionExprs(`steps[${i}].actions[${j}]`, a));
  }

  return out;
};

const referenceProblems = (plugin: Plugin): Problem[] => {
  const bindings = new Set(plugin.bindings.map((b) => b.name));

  return plugin.steps.flatMap((step, i) =>
    step.actions.flatMap((a, j): Problem[] => {
      const path = `steps[${i}].actions[${j}]`;

      return Action.match(a, {
        SmartSwitch: (x) =>
          bindings.has(x.binding)
            ? []
            : [{ path: `${path}.binding`, message: `unknown binding '${x.binding}'` }],
        SetState: (x) =>
          x.key in plugin.state
            ? []
            : [{ path: `${path}.key`, message: `state key '${x.key}' not declared` }],
        TeamChat: () => [],
        Notify: () => [],
      });
    }),
  );
};

const staticProblems = (plugin: Plugin): Problem[] => [
  ...exprsOf(plugin).flatMap(([path, expr]) => {
    const err = Cel.check(expr);

    return err === undefined ? [] : [{ path, message: `${err} in \`${expr}\`` }];
  }),
  ...referenceProblems(plugin),
];

const matches = (e: Engine.Effect_, x: Expected): boolean =>
  Engine.Effect_.$match(e, {
    TeamChat: (a) => Expected.guards.TeamChat(x) && a.text.includes(x.contains),
    Notify: (a) => Expected.guards.Notify(x) && a.text.includes(x.contains),
    SmartSwitch: (a) => Expected.guards.SmartSwitch(x) && a.binding === x.binding && a.on === x.on,
    SetState: (a) => Expected.guards.SetState(x) && a.key === x.key,
  });

const describe = (e: Engine.Effect_): string =>
  Engine.Effect_.$match(e, {
    TeamChat: (a) => `TeamChat("${a.text}")`,
    Notify: (a) => `Notify("${a.text}")`,
    SmartSwitch: (a) => `SmartSwitch(${a.binding}=${a.on})`,
    SetState: (a) => `SetState(${a.key}=${JSON.stringify(a.value)})`,
  });

const describeExpected = (x: Expected): string =>
  Expected.match(x, {
    TeamChat: (a) => `TeamChat~"${a.contains}"`,
    Notify: (a) => `Notify~"${a.contains}"`,
    SmartSwitch: (a) => `SmartSwitch(${a.binding}=${a.on})`,
    SetState: (a) => `SetState(${a.key})`,
  });

/** Ordered match: expected effects must appear in order, with nothing extra. */
/** Event-triggered fixtures must use exactly the payload the server sends for that kind. */
const eventPayloadProblem = (plugin: Plugin, fixture: Fixture): string | undefined => {
  if (!Trigger.guards.Event(plugin.trigger)) return undefined;

  const payload = EventPayloads[plugin.trigger.kind];

  const r = Schema.decodeUnknownExit(payload)(fixture.event ?? {}, {
    onExcessProperty: "error",
  });

  if (Exit.isSuccess(r)) return undefined;

  const fields = JSON.stringify(Object.keys(payload.fields));

  return `event must match the real ${plugin.trigger.kind} payload ${fields}: ${String(r.cause).split("\n")[0]}`;
};

export const runFixture = (plugin: Plugin, fixture: Fixture): Problem | undefined => {
  const path = `tests["${fixture.name}"]`;
  const payloadProblem = eventPayloadProblem(plugin, fixture);

  if (payloadProblem !== undefined) return { path: `${path}.event`, message: payloadProblem };

  try {
    const { effects } = Engine.run({
      plugin,
      world: fixtureWorld(fixture.world),
      event: fixture.event ?? {},
      state: { ...plugin.state, ...fixture.state },
      args: fixture.args ?? {},
    });

    const ok =
      effects.length === fixture.expect.length &&
      effects.every((e, i) => {
        const x = fixture.expect[i];

        return x !== undefined && matches(e, x);
      });

    if (ok) return undefined;

    const want = fixture.expect.map(describeExpected).join(", ");
    const got = effects.map(describe).join(", ");

    return { path, message: `expected [${want}] got [${got}]` };
  } catch (e) {
    return { path, message: e instanceof Engine.EvalError ? `${e.message} at ${e.at}` : String(e) };
  }
};

const decodePlugin = Schema.decodeUnknownExit(Plugin);

/** Accepts raw JSON (the agent's file); this is the trust boundary. */
export const validate = (json: Schema.Json): Result => {
  const decoded = decodePlugin(json);

  if (Exit.isFailure(decoded))
    return { ok: false, problems: [{ path: "", message: String(decoded.cause).slice(0, 2000) }] };

  const plugin = decoded.value;
  const problems = staticProblems(plugin);

  if (problems.length > 0) return { ok: false, problems };

  const failures = plugin.tests.flatMap((t) => runFixture(plugin, t) ?? []);

  return failures.length > 0
    ? { ok: false, problems: failures }
    : { ok: true, plugin, passed: plugin.tests.length };
};

export const jsonSchema = () => ({
  plugin: Schema.toJsonSchemaDocument(Plugin),
  /** `event` in CEL for each Event trigger kind (flat map, e.g. event.x). */
  eventPayloads: Object.fromEntries(
    Object.entries(EventPayloads).map(([k, s]) => [k, Object.keys(s.fields)]),
  ),
  celVariables: {
    now: "double unix seconds",
    team: "list<Member{steamId,name,x,y,online,alive,spawnTime,deathTime,lastMovedAt}>",
    markers: "list<Marker{id,kind,x,y,name}>",
    server: "map{name,mapSize,wipeTime,players,maxPlayers,queued}",
    time: "map{hour,sunrise,sunset,isDay}",
    devices: "map<bindingName,bool>",
    state: "map (this plugin's declared state)",
    args: "map (command args)",
    it: "current element inside a step with `each`",
    functions: "distance(x1,y1,x2,y2), grid(x,y) -> 'G12', minutes(seconds)",
  },
});
