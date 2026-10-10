// CEL environment for plugin expressions. Rows are registered as classes so field typos fail at
// `check` time (validate), not at runtime in the middle of a raid.
import { Environment } from "@marcbachmann/cel-js";
import { Predicate, Schema } from "effect";
import { Value, type ValueMap } from "./Plugin.ts";
import type { Marker, Member, World } from "./World.ts";

export class CelMember {
  constructor(
    readonly steamId: string,
    readonly name: string,
    readonly x: number,
    readonly y: number,
    readonly online: boolean,
    readonly alive: boolean,
    readonly spawnTime: number,
    readonly deathTime: number,
    readonly lastMovedAt: number,
  ) {}
}

export class CelMarker {
  constructor(
    readonly id: string,
    readonly kind: string,
    readonly x: number,
    readonly y: number,
    readonly name: string,
  ) {}
}

const member = (m: Member) =>
  new CelMember(
    m.steamId,
    m.name,
    m.x,
    m.y,
    m.online,
    m.alive,
    m.spawnTime,
    m.deathTime,
    m.lastMovedAt,
  );

const marker = (m: Marker) => new CelMarker(m.id, m.kind, m.x, m.y, m.name);

const memberFields = {
  steamId: "string",
  name: "string",
  x: "double",
  y: "double",
  online: "bool",
  alive: "bool",
  spawnTime: "double",
  deathTime: "double",
  lastMovedAt: "double",
} as const;

/** Rust map grid label, e.g. "G12". Grid cells are 146.25m; letters run along x, numbers down y. */
export const gridLabel = (x: number, y: number, mapSize: number): string => {
  const cell = 146.25;
  const col = Math.max(0, Math.floor(x / cell));
  const row = Math.max(0, Math.floor((mapSize - y) / cell));

  const letters =
    col < 26 ? String.fromCharCode(65 + col) : `A${String.fromCharCode(65 + col - 26)}`;

  return `${letters}${row}`;
};

// Evaluation is synchronous, so a module slot is enough to give grid() the current map size.
let mapSize = 4500;

const base = new Environment({
  enableOptionalTypes: true,
  limits: { maxAstNodes: 2000, maxDepth: 50 },
})
  .registerType("Member", { ctor: CelMember, fields: memberFields })
  .registerType("Marker", {
    ctor: CelMarker,
    fields: { id: "string", kind: "string", x: "double", y: "double", name: "string" },
  })
  .registerVariable("now", "double", { description: "Unix seconds" })
  .registerVariable("team", "list<Member>")
  .registerVariable("markers", "list<Marker>")
  .registerVariable("server", "map<string, dyn>", {
    description: "name, mapSize, wipeTime, players, maxPlayers, queued",
  })
  .registerVariable("time", "map<string, dyn>", { description: "hour, sunrise, sunset, isDay" })
  .registerVariable("devices", "map<string, bool>", { description: "binding name -> on/triggered" })
  .registerVariable("state", "map<string, dyn>")
  .registerVariable("event", "map<string, dyn>")
  .registerVariable("args", "map<string, dyn>")
  .registerVariable("it", "dyn", { description: "Current element inside a step with `each`" })
  .registerFunction("distance(double, double, double, double): double", (ax, ay, bx, by) =>
    Math.hypot(ax - bx, ay - by),
  )
  .registerFunction("grid(double, double): string", (x, y) => gridLabel(x, y, mapSize), {
    description: "Map grid label for a position, e.g. G12",
  })
  .registerFunction("minutes(double): double", (s) => s / 60);

export interface Scope {
  readonly world: World;
  readonly event: ValueMap;
  readonly state: ValueMap;
  readonly args: ValueMap;
  readonly it?: Value | CelMember | CelMarker;
}

const context = (scope: Scope) => ({
  now: scope.world.now,
  team: scope.world.team.map(member),
  markers: scope.world.markers.map(marker),
  server: scope.world.server,
  time: scope.world.time,
  devices: Object.fromEntries(scope.world.devices.map((d) => [d.binding, d.value])),
  state: scope.state,
  event: scope.event,
  args: scope.args,
  it: scope.it ?? null,
});

const firstLine = (e: Error) => e.message.split("\n")[0] ?? "";

/** Static check: syntax + types. Returns an error message or undefined. */
const MACROS = /\.(all|exists|exists_one|map|filter)\s*\(/g;

/**
 * Evaluation is synchronous on the bot's only thread, so cost must be bounded statically.
 * Comprehensions nest multiplicatively (team^depth); 2 levels costs ~5ms with a full team.
 */
const costProblem = (expr: string): string | undefined => {
  if (expr.length > 1000) return "expression longer than 1000 characters";

  let depth = 0;
  let max = 0;
  let open: number[] = [];

  // Track how many macro calls are open at once by matching their parentheses.
  for (let i = 0; i < expr.length; i++) {
    MACROS.lastIndex = i;

    const m = MACROS.exec(expr);

    if (m?.index === i) {
      depth++;
      max = Math.max(max, depth);
      open.push(0);
      i += m[0].length - 1;
      continue;
    }

    if (expr[i] === "(" && open.length > 0) open[open.length - 1]!++;

    if (expr[i] === ")" && open.length > 0) {
      if (open[open.length - 1] === 0) {
        open = open.slice(0, -1);
        depth--;
      } else open[open.length - 1]!--;
    }
  }

  return max > 2
    ? `comprehensions nested ${max} deep (max 2): split into steps with state`
    : undefined;
};

export const check = (expr: string): string | undefined => {
  const cost = costProblem(expr);

  if (cost !== undefined) return cost;

  try {
    const r = base.check(expr);

    return r.valid ? undefined : r.error ? firstLine(r.error) : "invalid";
  } catch (e) {
    return e instanceof Error ? firstLine(e) : String(e);
  }
};

/** A raw CEL result: JSON-like data plus cel-js representations (bigint ints, Map, row classes). */
type Raw =
  | bigint
  | Map<Raw, Raw>
  | ReadonlyArray<Raw>
  | { readonly [k: string]: Raw }
  | CelMember
  | CelMarker
  | Value;

const isRow = (v: Raw): v is CelMember | CelMarker =>
  v instanceof CelMember || v instanceof CelMarker;

/** Converts cel-js representations back to JSON. Anything else is rejected by decodeValue. */
const toJson = (v: Raw): Raw => {
  if (Predicate.isBigInt(v)) return Number(v);

  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), toJson(x)]));

  if (Array.isArray(v)) return v.map(toJson);

  if (isRow(v)) return { ...v };

  return v;
};

const decodeValue = Schema.decodeUnknownSync(Value);

// SAFETY: cel-js returns `any`; every result goes through toJson + decodeValue (or isRow) before use.
const raw = (expr: string, scope: Scope): Raw => {
  mapSize = scope.world.server.mapSize;

  return base.evaluate(expr, context(scope));
};

export const evaluate = (expr: string, scope: Scope): Value =>
  decodeValue(toJson(raw(expr, scope)));

/** Like evaluate, but list elements keep their row class so `it.name` stays type-safe. */
export const evaluateList = (
  expr: string,
  scope: Scope,
): ReadonlyArray<Value | CelMember | CelMarker> => {
  const v = raw(expr, scope);

  if (!Array.isArray(v)) throw new Error(`each must be a list, got ${String(v)}`);

  return v.map((x: Raw) => (isRow(x) ? x : decodeValue(toJson(x))));
};

/** Renders `{{expr}}` segments inside a text template. */
export const render = (template: string, scope: Scope): string =>
  template.replace(/\{\{(.+?)\}\}/g, (_, expr: string) => {
    const v = evaluate(expr.trim(), scope);

    return Array.isArray(v) ? v.join(", ") : String(v);
  });

export const templateExprs = (template: string): string[] =>
  [...template.matchAll(/\{\{(.+?)\}\}/g)].map((m) => (m[1] ?? "").trim());

export const definitions = () => base.getDefinitions();
