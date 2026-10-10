import { bot } from "#lib/server/bot.ts";

export const load = () => ({
  servers: bot()
    .servers()
    .map((s) => ({
      id: s.id,
      name: s.name,
      players: s.world ? `${s.world.server.players}/${s.world.server.maxPlayers}` : "–",
      queued: s.world?.server.queued ?? 0,
      team: (s.world?.team ?? []).map((m) => ({
        steamId: m.steamId,
        name: m.name,
        online: m.online,
        alive: m.alive,
      })),
    })),
});
