import { error, json } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

/** Polled by the map page. Positions only: no chat, no plugin state. */
export const GET = ({ params }) => {
  const s = bot()
    .servers()
    .find((x) => x.id === params.id);

  if (s?.world === undefined) error(404);

  return json({
    mapSize: s.world.server.mapSize,
    team: s.world.team.map((m) => ({
      name: m.name,
      x: m.x,
      y: m.y,
      online: m.online,
      alive: m.alive,
    })),
    markers: s.world.markers.map((m) => ({ kind: m.kind, x: m.x, y: m.y })),
  });
};
