import { error, json } from "@sveltejs/kit";
import { Option, Schema } from "effect";
import { bot } from "#lib/server/bot.ts";

const decodeBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ text: Schema.String })),
);

/** Team chat is per team: only the host and players with a role on this server see it. */
const member = (id: string, sid64: string | undefined) => {
  const b = bot();

  if (sid64 === undefined || (sid64 !== b.hostSteamId() && !b.settings().roles[id]?.[sid64]))
    error(403);

  return b;
};

export const GET = async ({ params, locals }) => {
  const chat = await member(params.id, locals.sid64).teamChat(params.id);

  if (chat === undefined) error(503, "Not connected");

  return json(chat);
};

export const POST = async ({ params, locals, request }) => {
  const b = member(params.id, locals.sid64);
  const body = await request.text();

  const text = Option.match(decodeBody(body), { onNone: () => "", onSome: (b) => b.text.trim() });

  if (text === "") error(400, "Empty message");

  const s = b.servers().find((x) => x.id === params.id);
  const name = s?.world?.team.find((m) => m.steamId === locals.sid64)?.name ?? "web";

  // Rust+ caps messages at 128 chars; the sink trims after adding the bot prefix.
  const sent = await b.sendTeamChat(params.id, `${name}: ${text}`).then(
    () => "",
    (e: { error?: string; message?: string }) =>
      e.error === "no_team"
        ? "Your in-game character isn't in a team, so there's no team chat."
        : `Rust+ refused the message: ${e.error ?? e.message ?? "unknown error"}`,
  );

  if (sent !== "") error(502, sent);

  return new Response(null, { status: 204 });
};
