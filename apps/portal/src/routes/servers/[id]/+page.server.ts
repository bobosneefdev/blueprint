import { bot } from "#lib/server/bot.ts";

export const load = ({ params }) => {
  const w = bot()
    .servers()
    .find((x) => x.id === params.id)?.world;

  return {
    world:
      w === undefined
        ? undefined
        : {
            players: w.server.players,
            maxPlayers: w.server.maxPlayers,
            queued: w.server.queued,
            wipeTime: w.server.wipeTime,
            hour: w.time.hour,
            isDay: w.time.isDay,
            team: w.team.map((m) => ({
              steamId: m.steamId,
              name: m.name,
              online: m.online,
              alive: m.alive,
            })),
          },
  };
};
