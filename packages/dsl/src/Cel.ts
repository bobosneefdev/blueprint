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
const MACROS = new Set(["all", "exists", "exists_one", "map", "filter"]);

/**
 * cel-js AST (untyped upstream): nodes are `{ op, args }` where args is a scalar, a node, or an
 * array of those; a method call is `{ op: "rcall", args: [name, target, callArgs] }`.
 */
type Ast = string | number | bigint | boolean | null | undefined | AstNode | ReadonlyArray<Ast>;

interface AstNode {
  readonly op: string;
  readonly args?: Ast;
}

const isNode = (v: Ast): v is AstNode => Predicate.isObject(v) && !Array.isArray(v) && "op" in v;

const children = (v: Ast): ReadonlyArray<Ast> => (Array.isArray(v) ? v : isNode(v) ? [v.args] : []);

const isCall = (v: Ast): v is AstNode => isNode(v) && v.op === "rcall";

/** Deepest nesting of comprehension macros, from the parsed AST (comments/strings can't fool it). */
const macroDepth = (v: Ast): number => {
  const self = isCall(v) && Array.isArray(v.args) && MACROS.has(String(v.args[0])) ? 1 : 0;

  return (
    self +
    Math.max(
      0,
      ...children(v)
        .flatMap((c) => (Array.isArray(c) ? c : [c]))
        .map(macroDepth),
    )
  );
};

/** Total `+` operators anywhere; list concatenation multiplies comprehension cost. */
const plusCount = (v: Ast): number =>
  (isNode(v) && v.op === "+" ? 1 : 0) +
  children(v)
    .flatMap((c) => (Array.isArray(c) ? c : [c]))
    .reduce((n: number, c) => n + plusCount(c), 0);

/**
 * Evaluation is synchronous on the bot's only thread, so cost must be bounded statically.
 * Comprehensions nest multiplicatively (list^depth); 2 levels over a full team costs ~5ms.
 */
const costProblem = (expr: string): string | undefined => {
  if (expr.length > 500) return "expression longer than 500 characters";

  // SAFETY: cel-js parse() returns its AST typed as any; Ast describes its documented shape.
  let ast: Ast;

  try {
    ast = base.parse(expr).ast;
  } catch {
    return undefined; // syntax errors are reported by check() below
  }

  const depth = macroDepth(ast);

  if (depth > 2) return `comprehensions nested ${depth} deep (max 2): split into steps with state`;

  // ponytail: + also covers number/string addition; 8 is ample for real plugins.
  if (depth > 0 && plusCount(ast) > 8) return "too many + in an expression with comprehensions";

  return undefined;
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
