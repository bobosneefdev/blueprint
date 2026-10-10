// Steam OpenID 2.0 sign-in. SID64 is the only identity in the app.
// Flow: redirect to steamcommunity.com -> Steam redirects back with openid.* params -> we POST them
// back to Steam with mode=check_authentication -> "is_valid:true" proves the claimed SID64.
const STEAM = "https://steamcommunity.com/openid/login";

/** Where to send the browser. `returnTo` must be on `realm` (the current tunnel origin). */
export const loginUrl = (realm: string, returnTo: string) =>
  `${STEAM}?${new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  })}`;

const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/**
 * Verifies a callback. `expectedReturnTo` blocks replaying an assertion minted for another site;
 * Steam itself checks the signature. Returns the SID64 or undefined.
 */
export const verify = async (
  params: URLSearchParams,
  expectedReturnTo: string,
  post: (body: URLSearchParams) => Promise<string> = async (body) =>
    (await fetch(STEAM, { method: "POST", body })).text(),
): Promise<string | undefined> => {
  const claimed = CLAIMED.exec(params.get("openid.claimed_id") ?? "")?.[1];
  const returnTo = params.get("openid.return_to") ?? "";

  if (params.get("openid.mode") !== "id_res" || claimed === undefined) return undefined;

  if (returnTo.split("?")[0] !== expectedReturnTo.split("?")[0]) return undefined;

  const check = new URLSearchParams(params);

  check.set("openid.mode", "check_authentication");

  return /is_valid\s*:\s*true/.test(await post(check)) ? claimed : undefined;
};
