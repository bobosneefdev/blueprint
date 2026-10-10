// Raw Rust+ responses -> plugin World, and World diffs -> plugin events.
// Pure functions: the poller calls these; tests and replay call them directly.
import type { Device, Marker, MarkerKind, Member, World } from "@better-rust/dsl";
import type { EventKind, ValueMap } from "@better-rust/dsl";
import type { AppInfo, AppMarker, AppTeamInfo, AppTime } from "./RustPlus.ts";

const markerKinds = new Map<number, MarkerKind>([
  [1, "player"],
  [2, "explosion"],
  [3, "vendingMachine"],
  [4, "chinook"],
  [5, "cargoShip"],
  [6, "crate"],
  [7, "genericRadius"],
  [8, "patrolHelicopter"],
]);

/** Rust+ time is in-game hours as a float (e.g. 13.5 = 1:30pm). */
const isDay = (t: AppTime) =>
  (t.time ?? 12) >= (t.sunrise ?? 7) && (t.time ?? 12) < (t.sunset ?? 20);

export interface Raw {
  readonly now: number;
  readonly info: AppInfo;
  readonly time: AppTime;
  readonly team: AppTeamInfo;
  readonly markers: ReadonlyArray<AppMarker>;
  readonly devices: ReadonlyArray<Device>;
}

/**
 * `previous` supplies lastMovedAt: Rust+ has no AFK flag, so we record when each member's
 * position last changed.
 */
export const toWorld = (raw: Raw, previous: World | undefined): World => {
  const before = new Map(previous?.team.map((m) => [m.steamId, m]));

  const team = (raw.team.members ?? []).map((m): Member => {
    const steamId = m.steamId ?? "";
    const x = m.x ?? 0;
    const y = m.y ?? 0;
    const prev = before.get(steamId);

    const moved =
      prev === undefined || prev.x !== x || prev.y !== y || prev.online !== (m.isOnline ?? false);

    return {
      steamId,
      name: m.name ?? "",
      x,
      y,
      online: m.isOnline ?? false,
      alive: m.isAlive ?? false,
      spawnTime: m.spawnTime ?? 0,
      deathTime: m.deathTime ?? 0,
      lastMovedAt: moved ? raw.now : prev.lastMovedAt,
    };
  });

  const markers = raw.markers.flatMap((m): Marker[] => {
    const kind = markerKinds.get(m.type ?? 0);

    return kind === undefined || kind === "player"
      ? []
      : [{ id: String(m.id ?? 0), kind, x: m.x ?? 0, y: m.y ?? 0, name: m.name ?? "" }];
  });

  return {
    now: raw.now,
    server: {
      name: raw.info.name ?? "",
      mapSize: raw.info.mapSize ?? 0,
      wipeTime: raw.info.wipeTime ?? 0,
      players: raw.info.players ?? 0,
      maxPlayers: raw.info.maxPlayers ?? 0,
      queued: raw.info.queuedPlayers ?? 0,
    },
    time: {
      hour: raw.time.time ?? 12,
      sunrise: raw.time.sunrise ?? 7,
      sunset: raw.time.sunset ?? 20,
      isDay: isDay(raw.time),
    },
    team,
    markers,
    devices: raw.devices,
  };
};

export interface Event {
  readonly kind: EventKind;
  readonly payload: ValueMap;
}

const ev = (kind: EventKind, payload: ValueMap): Event => ({ kind, payload });

const memberPayload = (m: Member): ValueMap => ({
  steamId: m.steamId,
  name: m.name,
  x: m.x,
  y: m.y,
});

/** Derives polled events. Pushed events (team chat, device changes) come from broadcasts. */
export const diff = (prev: World, next: World): Event[] => {
  const events: Event[] = [];

  if (prev.server.wipeTime !== 0 && next.server.wipeTime !== prev.server.wipeTime)
    events.push(ev("wipe", { wipeTime: next.server.wipeTime }));

  if (!prev.time.isDay && next.time.isDay) events.push(ev("dayStarted", {}));

  if (prev.time.isDay && !next.time.isDay) events.push(ev("nightStarted", {}));

  const before = new Map(prev.team.map((m) => [m.steamId, m]));

  for (const m of next.team) {
    const p = before.get(m.steamId);

    if (p === undefined) continue;

    if (!p.online && m.online) events.push(ev("memberOnline", memberPayload(m)));

    if (p.online && !m.online) events.push(ev("memberOffline", memberPayload(m)));

    if (p.alive && !m.alive) events.push(ev("memberDied", memberPayload(m)));

    if (!p.alive && m.alive) events.push(ev("memberRespawned", memberPayload(m)));
  }

  const prevIds = new Set(prev.markers.map((m) => m.id));
  const nextIds = new Set(next.markers.map((m) => m.id));

  const markerPayload = (m: Marker): ValueMap => ({
    id: m.id,
    kind: m.kind,
    x: m.x,
    y: m.y,
    name: m.name,
  });

  for (const m of next.markers)
    if (!prevIds.has(m.id)) events.push(ev("markerAppeared", markerPayload(m)));

  for (const m of prev.markers)
    if (!nextIds.has(m.id)) events.push(ev("markerDisappeared", markerPayload(m)));

  return events;
};
