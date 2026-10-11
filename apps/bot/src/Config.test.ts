import { expect, test } from "bun:test";
import { merge, migrateAllowlist } from "./Config.ts";

const base = {
  botName: "bot",
  hostSteamId: "1",
  harness: "claude" as const,
  model: "opus",
  portalPort: 1,
  rpcPort: 2,
  sessionSecret: "s",
};

test("merge applies settings and drops blank optionals", () => {
  const c = merge(base, {
    botName: "rusty",
    roles: { s: { "2": "admin" } },
    harness: "pi",
    model: undefined,
    effort: undefined,
    fast: false,
    ntfyTopic: "t",
    discordWebhook: undefined,
  });

  expect([
    c.botName,
    c.roles,
    c.harness,
    "model" in c,
    "fast" in c,
    c.ntfyTopic,
    c.hostSteamId,
  ]).toEqual(["rusty", { s: { "2": "admin" } }, "pi", false, false, "t", "1"]);
});

test("old allowlist becomes admin on every server, keeping explicit roles", () => {
  const c = migrateAllowlist(
    { ...base, allowlist: ["2", "3"], roles: { a: { "3": "interact" } } },
    ["a", "b"],
  );

  expect(["allowlist" in c, c.roles]).toEqual([
    false,
    { a: { "3": "interact", "2": "admin" }, b: { "2": "admin", "3": "admin" } },
  ]);
});
