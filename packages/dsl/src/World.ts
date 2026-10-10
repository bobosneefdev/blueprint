// The normalized snapshot every plugin expression evaluates against.
// Mirrors Rust+ data (rustplus.proto) but flattened: all numbers are doubles, times are unix
// seconds, ids are strings. Plugins never see raw protobuf.
import { Schema } from "effect";

export const Member = Schema.Struct({
  steamId: Schema.String,
  name: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  online: Schema.Boolean,
  alive: Schema.Boolean,
  spawnTime: Schema.Number,
  deathTime: Schema.Number,
  /** Derived by the poller: last time x/y changed. Rust+ has no AFK flag; this is the heuristic. */
  lastMovedAt: Schema.Number,
});

export interface Member extends Schema.Schema.Type<typeof Member> {}

export const MarkerKind = Schema.Literals([
  "player",
  "explosion",
  "vendingMachine",
  "chinook",
  "cargoShip",
  "crate",
  "genericRadius",
  "patrolHelicopter",
]);

export type MarkerKind = typeof MarkerKind.Type;

export const Marker = Schema.Struct({
  id: Schema.String,
  kind: MarkerKind,
  x: Schema.Number,
  y: Schema.Number,
  name: Schema.String,
});

export interface Marker extends Schema.Schema.Type<typeof Marker> {}

export const Device = Schema.Struct({
  binding: Schema.String,
  kind: Schema.Literals(["switch", "alarm", "storageMonitor"]),
  value: Schema.Boolean,
});

export interface Device extends Schema.Schema.Type<typeof Device> {}

export const World = Schema.Struct({
  now: Schema.Number,
  server: Schema.Struct({
    name: Schema.String,
    mapSize: Schema.Number,
    wipeTime: Schema.Number,
    players: Schema.Number,
    maxPlayers: Schema.Number,
    queued: Schema.Number,
  }),
  time: Schema.Struct({
    hour: Schema.Number,
    sunrise: Schema.Number,
    sunset: Schema.Number,
    isDay: Schema.Boolean,
  }),
  team: Schema.Array(Member),
  markers: Schema.Array(Marker),
  devices: Schema.Array(Device),
});

export interface World extends Schema.Schema.Type<typeof World> {}
