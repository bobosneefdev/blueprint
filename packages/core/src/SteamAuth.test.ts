import { expect, test } from "bun:test";
import { loginUrl, verify } from "./SteamAuth.ts";

const returnTo = "https://abc.trycloudflare.com/auth/callback";

const callback = (over: Record<string, string> = {}) =>
  new URLSearchParams({
    "openid.mode": "id_res",
    "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198118274372",
    "openid.return_to": `${returnTo}?n=1`,
    "openid.sig": "x",
    ...over,
  });

test("loginUrl points at Steam with our realm", () => {
  const u = new URL(loginUrl("https://abc.trycloudflare.com", returnTo));

  expect(u.host).toBe("steamcommunity.com");
  expect(u.searchParams.get("openid.realm")).toBe("https://abc.trycloudflare.com");
});

test("verify: valid, rejected by Steam, wrong return_to, bad claimed id", async () => {
  const valid = async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n";
  const invalid = async () => "is_valid:false\n";

  expect(await verify(callback(), returnTo, valid)).toBe("76561198118274372");
  expect(await verify(callback(), returnTo, invalid)).toBeUndefined();
  expect(
    await verify(
      callback({ "openid.return_to": "https://evil.example/auth/callback" }),
      returnTo,
      valid,
    ),
  ).toBeUndefined();
  expect(
    await verify(
      callback({ "openid.claimed_id": "https://evil.example/openid/id/76561198118274372" }),
      returnTo,
      valid,
    ),
  ).toBeUndefined();
});

test("verify sends check_authentication", async () => {
  let sent = "";

  await verify(callback(), returnTo, async (b) => {
    sent = b.get("openid.mode") ?? "";

    return "is_valid:true";
  });
  expect(sent).toBe("check_authentication");
});
