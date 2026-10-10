import { expect, test } from "bun:test";
import { argv, parse } from "./Harness.ts";

// Captured from real runs (claude 2.1.296, codex-cli 0.162.1) and Pi's documented JSON mode.
const claudeOut = `{"type":"result","subtype":"success","is_error":false,"result":"pong","session_id":"s-1","num_turns":1}`;

const codexOut = [
  `{"type":"thread.started","thread_id":"t-1"}`,
  `{"type":"turn.started"}`,
  `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}`,
  `{"type":"turn.completed","usage":{}}`,
].join("\n");

const piOut = [
  `{"type":"session","version":3,"id":"p-1","timestamp":"x","cwd":"/workspace"}`,
  `{"type":"message_end","message":{"role":"user","content":"hi"}}`,
  `{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"pong"}]}}`,
  `{"type":"agent_settled","aborted":false}`,
].join("\n");

test("parses each harness's final reply and session", () => {
  expect(parse("claude", claudeOut, 0)).toEqual({ text: "pong", session: "s-1", ok: true });
  expect(parse("codex", codexOut, 0)).toEqual({ text: "pong", session: "t-1", ok: true });
  expect(parse("pi", piOut, 0)).toEqual({ text: "pong", session: "p-1", ok: true });
  expect(parse("claude", "garbage", 1).ok).toBe(false);
});

test("resume flags per harness", () => {
  const base = { prompt: "hi", systemPrompt: "sys", session: "x", model: undefined };

  expect(argv({ ...base, kind: "claude" })).toContain("--resume");
  expect(argv({ ...base, kind: "codex" }).slice(0, 4)).toEqual(["codex", "exec", "resume", "x"]);
  expect(argv({ ...base, kind: "pi" })).toContain("--session-id");
});
