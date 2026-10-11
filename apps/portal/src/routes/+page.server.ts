import { bot } from "#lib/server/bot.ts";

export const load = ({ locals }) => ({
  // The setup wizard only opens on the host PC, so only point the host there.
  setupLink: locals.local && locals.sid64 === bot().hostSteamId(),
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
