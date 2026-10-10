import { error } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

export const GET = async ({ params }) => {
  const map = await bot().mapImage(params.id);

  if (map === undefined) error(404, "Map not available yet");

  return new Response(new Blob([Uint8Array.from(map.jpg)]), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" },
  });
};
