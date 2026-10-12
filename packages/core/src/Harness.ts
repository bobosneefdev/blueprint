// Drives Claude Code, Codex or Pi headless, one turn per call, resuming a per-requester session.
// All three run with permission prompts bypassed: the WSL distro is the security boundary.
//
// On Windows the argv is prefixed with `wsl.exe -d blueprint-agent -u agent --cd /workspace --`.
// Tests and Linux dev run the harness directly.
import { Option, Predicate, Schema } from "effect";

export type Kind = "claude" | "codex" | "pi";

export interface Turn {
  readonly kind: Kind;
  readonly prompt: string;
  /** Harness session/thread id from a previous turn; undefined starts a new session. */
  readonly session: string | undefined;
  readonly systemPrompt: string;
  readonly model: string | undefined;
  /** Reasoning level from the harness's own model list (validated as a bare word upstream). */
  readonly effort?: string | undefined;
  readonly fast?: boolean | undefined;
}

export interface Reply {
  readonly text: string;
  readonly session: string | undefined;
  readonly ok: boolean;
}

/** Builds the command line for one turn. Pure, so it is testable without the harness installed. */
export const argv = (t: Turn): string[] => {
  const model = t.model === undefined ? [] : ["--model", t.model];
  const effort = t.effort === undefined ? [] : [t.effort];

  switch (t.kind) {
    case "claude":
      return [
        "claude",
        "-p",
        t.prompt,
        "--output-format",
        "json",
        "--dangerously-skip-permissions",
        "--append-system-prompt",
        t.systemPrompt,
        // Game data is local and authoritative; web results are stale or wrong.
        "--disallowedTools=WebSearch,WebFetch",
        ...model,
        ...effort.flatMap((e) => ["--effort", e]),
        ...(t.fast === true ? ["--settings", '{"fastMode":true}'] : []),
        ...(t.session === undefined ? [] : ["--resume", t.session]),
      ];
    case "codex":
      // Codex has no system-prompt flag; AGENTS.md in /workspace carries the instructions.
      return [
        "codex",
        "exec",
        ...(t.session === undefined ? [] : ["resume", t.session]),
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-c",
        'web_search="disabled"',
        ...(t.model === undefined ? [] : ["-m", t.model]),
        ...effort.flatMap((e) => ["-c", `model_reasoning_effort="${e}"`]),
        ...(t.fast === true ? ["-c", 'service_tier="fast"'] : []),
        t.prompt,
      ];
    case "pi":
      // Pi has no web tool to switch off.
      return [
        "pi",
        "--mode",
        "json",
        "--append-system-prompt",
        t.systemPrompt,
        // /workspace/AGENTS.md (for codex) holds the same prompt; don't load it twice.
        "--no-context-files",
        ...model,
        ...effort.flatMap((e) => ["--thinking", e]),
        ...(t.session === undefined ? [] : ["--session-id", t.session]),
        t.prompt,
      ];
  }
};

// Only the fields we read; everything else in each event is ignored.
const Event = Schema.Struct({
  type: Schema.String,
  // claude
  result: Schema.optionalKey(Schema.String),
  session_id: Schema.optionalKey(Schema.String),
  is_error: Schema.optionalKey(Schema.Boolean),
  // codex
  thread_id: Schema.optionalKey(Schema.String),
  item: Schema.optionalKey(
    Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
  ),
  // pi
  id: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(
    Schema.Struct({
      role: Schema.String,
      content: Schema.Union([
        Schema.String,
        Schema.Array(
          Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
        ),
      ]),
    }),
  ),
});

type Event = typeof Event.Type;

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Event));

/** JSONL stdout -> decoded events. Non-JSON lines (warnings, banners) are skipped. */
const events = (stdout: string): Event[] =>
  stdout.split("\n").flatMap((l) => Option.toArray(decodeLine(l.trim())));

const piText = (e: Event | undefined) =>
  Predicate.isString(e?.message?.content)
    ? e.message.content
    : (e?.message?.content ?? [])
        .flatMap((c) => (c.type === "text" && c.text ? [c.text] : []))
        .join("");

/** Parses each harness's stdout into the final reply text and session id. */
export const parse = (kind: Kind, stdout: string, exitCode: number): Reply => {
  const es = events(stdout);

  switch (kind) {
    case "claude": {
      const r = es.findLast((e) => e.type === "result");

      return {
        text: r?.result ?? "",
        session: r?.session_id,
        ok: exitCode === 0 && r?.is_error !== true,
      };
    }

    case "codex": {
      const thread = es.find((e) => e.type === "thread.started")?.thread_id;

      const last = es.findLast(
        (e) => e.type === "item.completed" && e.item?.type === "agent_message",
      );

      const failed = es.some((e) => e.type === "turn.failed" || e.type === "error");

      return { text: last?.item?.text ?? "", session: thread, ok: exitCode === 0 && !failed };
    }

    case "pi": {
      const header = es.find((e) => e.type === "session")?.id;

      const last = es.findLast((e) => e.type === "message_end" && e.message?.role === "assistant");

      return { text: piText(last), session: header, ok: exitCode === 0 };
    }
  }
};
