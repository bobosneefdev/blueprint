import { expect, test } from "bun:test";
import { CHAT_LIMIT, chatLines, makeQueue, mayUseAgent, mention } from "./Agent.ts";

const settings = { name: "bot", hostSteamId: "1", allowlist: ["2"], portalUrl: undefined };

test("mention", () => {
  expect(mention(settings, "@bot alert me when cargo spawns")).toBe("alert me when cargo spawns");
  expect(mention(settings, "@BOT, hi")).toBe("hi");
  expect(mention(settings, "@bottle hi")).toBeUndefined();
  expect(mention(settings, "hey @bot hi")).toBeUndefined();
  expect(mention(settings, "@bot")).toBeUndefined();
  expect(mention({ ...settings, name: "rusty.ai" }, "@rusty.ai go")).toBe("go");
});

test("permissions", () => {
  expect([
    mayUseAgent(settings, "1"),
    mayUseAgent(settings, "2"),
    mayUseAgent(settings, "3"),
  ]).toEqual([true, true, false]);
});

test("chatLines fits Rust chat and links overflow", () => {
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
  const lines = chatLines(long, "https://x.trycloudflare.com/r/1");

  expect(lines.length).toBe(3);
  expect(lines.every((l) => l.length <= CHAT_LIMIT)).toBe(true);
  expect(lines[2]?.endsWith("full: https://x.trycloudflare.com/r/1")).toBe(true);
  expect(chatLines("short answer", undefined)).toEqual(["short answer"]);
});

test("one job per requester", () => {
  const q = makeQueue();

  expect([q.tryStart("1"), q.tryStart("1"), q.tryStart("2")]).toEqual([true, false, true]);
  q.finish("1");
  expect(q.tryStart("1")).toBe(true);
});
