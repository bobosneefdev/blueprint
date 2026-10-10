import { expect, test } from "bun:test";
import { diff, type Raw, toWorld } from "./Snapshot.ts";

const raw = (over: Partial<Raw>): Raw => ({
  now: 1000,
  info: { name: "s", mapSize: 4500, wipeTime: 50 },
  time: { time: 12, sunrise: 7, sunset: 20 },
  team: { members: [{ steamId: "1", name: "Bob", x: 10, y: 10, isOnline: true, isAlive: true }] },
  markers: [],
  devices: [],
  ...over,
});

test("lastMovedAt sticks while still, resets on move", () => {
  const a = toWorld(raw({ now: 1000 }), undefined);
  const b = toWorld(raw({ now: 1600 }), a);

  const c = toWorld(
    raw({
      now: 1700,
      team: { members: [{ steamId: "1", x: 11, y: 10, isOnline: true, isAlive: true }] },
    }),
    b,
  );

  expect([a.team[0]?.lastMovedAt, b.team[0]?.lastMovedAt, c.team[0]?.lastMovedAt]).toEqual([
    1000, 1000, 1700,
  ]);
});

test("diff emits marker, member, day/night and wipe events", () => {
  const a = toWorld(raw({}), undefined);

  const b = toWorld(
    raw({
      info: { name: "s", mapSize: 4500, wipeTime: 99 },
      time: { time: 21, sunrise: 7, sunset: 20 },
      team: {
        members: [{ steamId: "1", name: "Bob", x: 10, y: 10, isOnline: true, isAlive: false }],
      },
      markers: [
        { id: 7, type: 5, x: 1, y: 2 },
        { id: 8, type: 1 },
      ],
    }),
    a,
  );

  expect(diff(a, b).map((e) => e.kind)).toEqual([
    "wipe",
    "nightStarted",
    "memberDied",
    "markerAppeared",
  ]);
  expect(diff(a, b).at(-1)?.payload).toEqual({ id: "7", kind: "cargoShip", x: 1, y: 2, name: "" });
});
