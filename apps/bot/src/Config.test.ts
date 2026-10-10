import { expect, test } from "bun:test";
import { merge } from "./Config.ts";

const base = {
  botName: "bot",
  hostSteamId: "1",
  allowlist: [],
  harness: "claude" as const,
  model: "opus",
  portalPort: 1,
  rpcPort: 2,
  sessionSecret: "s",
};

test("merge applies settings and drops blank optionals", () => {
  const c = merge(base, {
    botName: "rusty",
    allowlist: ["2"],
    harness: "pi",
    model: undefined,
    ntfyTopic: "t",
  });

  expect([c.botName, c.allowlist, c.harness, "model" in c, c.ntfyTopic, c.hostSteamId]).toEqual([
    "rusty",
    ["2"],
    "pi",
    false,
    "t",
    "1",
  ]);
});
