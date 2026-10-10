import { createServer } from "node:http";
import { attach } from "./src/lib/server/bot.ts";
import { Validate } from "@better-rust/dsl";

attach({
  sessionSecret: "dev",
  hostSteamId: () => "76561198118274372",
  allowlist: () => [],
  publicUrl: () => "https://calm-river.trycloudflare.com",
  servers: () => [{ id: "1", name: "T", world: Validate.emptyWorld }],
  plugins: () => [],
  setEnabled: async () => {},
  rollback: async () => {},
  reply: () => undefined,
  pairing: () => ({ signedIn: true, hostSteamId: "76561198118274372" }),
  pair: async () => "",
  settings: () => ({
    botName: "bot",
    allowlist: [],
    harness: "claude",
    model: undefined,
    ntfyTopic: undefined,
  }),
  saveSettings: async () => {},
  importPlugin: async () => [],
  activity: () => [],
  saveHarnessCredential: async () => {},
  diff: () => "",
  mapImage: async () => undefined,
});

const { handler } = await import("./build/handler.js");

createServer(handler).listen(4173, "127.0.0.1");

console.log("up");
