// Plugin DSL. Effect Schema is the single source of truth: TS types, runtime validation, and the
// JSON Schema handed to the agent all derive from here.
//
// Expressions (`Expr`) are CEL strings evaluated against `World` + the trigger's `event` + the
// plugin's `state` + its `args`. See Cel.ts for the exact environment.
import { Schema, Struct } from "effect";
import { Marker, Member, World } from "./World.ts";

export const Expr = Schema.String.check(Schema.isMinLength(1)).annotate({
  description: "CEL expression. Numbers are doubles: write 600.0, not 600.",
});

export const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,31}$/));

/** JSON-compatible value: state, event payloads, CEL results. */
export const Value = Schema.Json;

export type Value = typeof Value.Type;

export const ValueMap = Schema.Record(Schema.String, Value);

export type ValueMap = typeof ValueMap.Type;

// ── Triggers ─────────────────────────────────────────────────────────────────────────────────────

export const EventKind = Schema.Literals([
  "teamChanged",
  "teamChat",
  "memberOnline",
  "memberOffline",
  "memberDied",
  "memberRespawned",
  "markerAppeared",
  "markerDisappeared",
  "deviceChanged",
  "dayStarted",
  "nightStarted",
  "wipe",
]);

export type EventKind = typeof EventKind.Type;

export const Arg = Schema.Struct({
  name: Name,
  type: Schema.Literals(["string", "number"]),
  optional: Schema.optionalKey(Schema.Boolean),
});

export interface Arg extends Schema.Schema.Type<typeof Arg> {}

const Every = Schema.Number.check(Schema.isGreaterThanOrEqualTo(10));

export const Trigger = Schema.TaggedUnion({
  Command: { name: Name, args: Schema.Array(Arg) },
  Schedule: { everySeconds: Every },
  CommandAndSchedule: { name: Name, args: Schema.Array(Arg), everySeconds: Every },
  Event: { kind: EventKind, filter: Schema.optionalKey(Expr) },
});

export type Trigger = typeof Trigger.Type;

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────

/** `text` is a template: `{{expr}}` segments are CEL, rendered with string(). */
export const Action = Schema.TaggedUnion({
  TeamChat: { text: Schema.String },
  SmartSwitch: { binding: Name, on: Expr },
  SetState: { key: Name, value: Expr },
  Notify: { text: Schema.String, channel: Schema.Literals(["toast", "phone", "both"]) },
});

export type Action = typeof Action.Type;

/** Runs `actions` once per element of `each` (a CEL list); the element is `it` in expressions. */
export const Step = Schema.Struct({
  when: Schema.optionalKey(Expr),
  each: Schema.optionalKey(Expr),
  actions: Schema.Array(Action).check(Schema.isMinLength(1)),
});

export interface Step extends Schema.Schema.Type<typeof Step> {}

// ── Bindings, tests ──────────────────────────────────────────────────────────────────────────────

export const Binding = Schema.Struct({
  name: Name,
  kind: Schema.Literals(["switch", "alarm", "storageMonitor", "location"]),
  description: Schema.String,
});

export interface Binding extends Schema.Schema.Type<typeof Binding> {}

/** Expected effect in a fixture. Text effects match by substring. */
export const Expected = Schema.TaggedUnion({
  TeamChat: { contains: Schema.String },
  Notify: { contains: Schema.String },
  SmartSwitch: { binding: Name, on: Schema.Boolean },
  SetState: { key: Name },
});

export type Expected = typeof Expected.Type;

const partial = <F extends Schema.Struct.Fields>(s: Schema.Struct<F>) =>
  s.mapFields(Struct.map(Schema.optionalKey));

/** World with every field optional; missing fields fall back to defaults (see Validate.ts). */
export const FixtureWorld = Schema.Struct({
  now: Schema.optionalKey(Schema.Number),
  server: Schema.optionalKey(partial(World.fields.server)),
  time: Schema.optionalKey(partial(World.fields.time)),
  team: Schema.optionalKey(
    Schema.Array(partial(Member).mapFields(Struct.assign({ steamId: Schema.String }))),
  ),
  markers: Schema.optionalKey(
    Schema.Array(partial(Marker).mapFields(Struct.assign({ kind: Marker.fields.kind }))),
  ),
  devices: Schema.optionalKey(World.fields.devices),
});

export interface FixtureWorld extends Schema.Schema.Type<typeof FixtureWorld> {}

export const Fixture = Schema.Struct({
  name: Schema.String,
  world: FixtureWorld,
  event: Schema.optionalKey(ValueMap),
  args: Schema.optionalKey(ValueMap),
  state: Schema.optionalKey(ValueMap),
  expect: Schema.Array(Expected),
});

export interface Fixture extends Schema.Schema.Type<typeof Fixture> {}

// ── Plugin ───────────────────────────────────────────────────────────────────────────────────────

export const Plugin = Schema.Struct({
  name: Name,
  description: Schema.String,
  version: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  /** Shown to users when the logic approximates data Rust+ does not expose (e.g. AFK). */
  heuristic: Schema.optionalKey(Schema.String),
  trigger: Trigger,
  /** Declared state keys and their initial values. */
  state: ValueMap,
  bindings: Schema.Array(Binding),
  steps: Schema.Array(Step).check(Schema.isMinLength(1)),
  /** Max team chat messages per rolling minute. */
  chatBudget: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 10 })),
  tests: Schema.Array(Fixture).check(Schema.isMinLength(1)),
});

export interface Plugin extends Schema.Schema.Type<typeof Plugin> {}
