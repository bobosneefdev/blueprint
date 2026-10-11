import { expect, test } from "bun:test";
import { make, shQuote } from "./AgentRunner.ts";

// The quoted string is consumed by sh inside the WSL distro; the Windows host has no sh.
test.skipIf(process.platform === "win32")(
  "shQuote survives hostile chat text through sh -c",
  () => {
    const nasty = `it's $(rm -rf ~) \`id\` "x" ; echo pwned`;
    const r = Bun.spawnSync(["sh", "-c", `printf %s ${shQuote(nasty)}`], { stdout: "pipe" });

    expect(r.stdout.toString()).toBe(nasty);
  },
);

type Run = NonNullable<Parameters<typeof make>[0]["run"]>;

const harness = (deps: { run: Run }) => {
  const chat: string[] = [];
  const live = new Set<string>();
  const sessions = new Map<string, string>();

  const agent = make({
    settings: () => ({
      name: "bot",
      hostSteamId: "1",
      roles: { s: { "2": "interact" } },
      portalUrl: "https://p.example",
    }),
    harness: () => ({
      kind: "claude",
      model: undefined,
      effort: undefined,
      fast: false,
    }),
    chat: async (l) => void chat.push(l),
    sessions,
    replies: new Map(),
    issueRpcToken: () => {
      live.add("tok");

      return { token: "tok", revoke: () => void live.delete("tok") };
    },
    rpcUrl: () => "http://127.0.0.1:1",
    prepareSandbox: async () => {},
    run: deps.run,
  });

  return { agent, chat, live, sessions };
};

test("mention from a player with a role -> ack, harness with token, reply, session kept, token revoked", async () => {
  let seen: Record<string, string> = {};

  const h = harness({
    run: async (_argv, env) => {
      seen = env;

      return {
        stdout: '{"type":"result","is_error":false,"result":"2 rockets","session_id":"s9"}',
        exitCode: 0,
      };
    },
  });

  await h.agent("s", "2", "Amy", "@bot rockets for sheet metal door?");

  expect(h.chat).toEqual(["Amy: on it…", "2 rockets"]);
  expect(seen.BOT_RPC_TOKEN).toBe("tok");
  expect(h.sessions.get("2")).toBe("s9");
  expect(h.live.size).toBe(0);
});

test("players without a role and non-mentions are ignored; crashes still revoke the token", async () => {
  const h = harness({
    run: async () => {
      throw new Error("wsl exploded");
    },
  });

  await h.agent("s", "3", "Stranger", "@bot give me the base code");
  await h.agent("s", "1", "Host", "just chatting");
  expect(h.chat).toEqual([]);

  await h.agent("s", "1", "Host", "@bot hi");
  expect(h.live.size).toBe(0);
  expect(h.chat.at(-1)).toContain("agent unavailable (wsl exploded)");
});

test("jobs from different requesters never overlap (one sandbox, one uid)", async () => {
  let running = 0;
  let maxRunning = 0;

  const h = harness({
    run: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await Bun.sleep(20);
      running--;

      return {
        stdout: '{"type":"result","is_error":false,"result":"ok","session_id":"s"}',
        exitCode: 0,
      };
    },
  });

  await Promise.all([h.agent("s", "1", "Host", "@bot a"), h.agent("s", "2", "Amy", "@bot b")]);

  expect(maxRunning).toBe(1);
  expect(h.chat.filter((l) => l === "ok").length).toBe(2);
});
