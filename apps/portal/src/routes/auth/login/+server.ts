import { redirect } from "@sveltejs/kit";
import { SteamAuth } from "@blueprint/core";
import { authOrigin } from "#lib/server/origin.ts";

// Quick-tunnel URLs change every start, so realm/return_to come from the current origin.
export const GET = ({ request, url }) => {
  const origin = authOrigin(request, url);

  redirect(303, SteamAuth.loginUrl(origin, `${origin}/auth/callback`), {
    external: ["https://steamcommunity.com"],
  });
};
