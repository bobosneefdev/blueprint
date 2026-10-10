// Team chat -> agent: mention parsing, permissions, one job per requester, ack + short reply.
// The harness itself runs elsewhere (Harness.ts + WSL); this module only decides who may talk
// to it and how replies fit into Rust's ~128-char team chat.

export interface Settings {
  /** Mention name, default "bot". Matched case-insensitively as "@name". */
  readonly name: string;
  readonly hostSteamId: string;
  readonly allowlist: ReadonlyArray<string>;
  readonly portalUrl: string | undefined;
}

export const CHAT_LIMIT = 128;

/** "@bot alert me when cargo spawns" -> "alert me when cargo spawns". */
export const mention = (settings: Settings, text: string): string | undefined => {
  const m = new RegExp(
    `^\\s*@${settings.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[\\s,:]*(.*)$`,
    "is",
  ).exec(text);

  return m?.[1]?.trim() || undefined;
};

export const mayUseAgent = (settings: Settings, steamId: string) =>
  steamId === settings.hostSteamId || settings.allowlist.includes(steamId);

/** Splits on word boundaries into at most `max` chat lines; overflow points at the portal. */
export const chatLines = (text: string, link: string | undefined, max = 3): string[] => {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let line = "";

  for (const w of words) {
    const next = line === "" ? w : `${line} ${w}`;

    if (next.length <= CHAT_LIMIT) {
      line = next;
      continue;
    }

    out.push(line);
    line = w.slice(0, CHAT_LIMIT);
  }

  if (line !== "") out.push(line);

  if (out.length <= max) return out;

  const more = link === undefined ? "…" : `… full: ${link}`;
  const kept = out.slice(0, max);
  const last = kept[max - 1] ?? "";

  kept[max - 1] = `${last.slice(0, CHAT_LIMIT - more.length - 1)} ${more}`;

  return kept;
};

/** One job per requester at a time. Returns false if they already have one running. */
export const makeQueue = () => {
  const busy = new Set<string>();

  return {
    tryStart: (steamId: string) => {
      if (busy.has(steamId)) return false;

      busy.add(steamId);

      return true;
    },
    finish: (steamId: string) => void busy.delete(steamId),
  };
};

export const systemPrompt = (
  settings: Settings,
) => `You are ${settings.name}, a Rust (the survival game) team assistant
reachable from in-game team chat. Replies go to team chat: be brief, plain text, no markdown.

You can do two things:
1. Answer questions about the game. Use \`bot items <query>\` and \`bot raid <target>\` for item,
   crafting, recycling and raid data. For anything else, search /data/rust-items-json/data with
   rg or jq. Never guess numbers; if the data does not have it, say so.
2. Build plugins when asked for a feature ("alert me when...", "every 10 min tell us..."):
   - \`bot schema\` prints the plugin JSON Schema, the exact \`event\` fields for every Event
     trigger, and the CEL variables/functions. Read it first. Live data: \`bot team\`, \`bot markers\`,
     \`bot info\`, \`bot devices\`.
   - Write plugins/<name>.json in /workspace. Include fixture tests that cover the behaviour.
   - Run \`bot validate plugins/<name>.json\` until it passes, then \`bot dry-run\` on it.
   - Finish with \`bot propose plugins/<name>.json\`; the requester confirms in chat.

Rust+ does NOT expose: AFK status, inventory, enemy players, raids (unless a smart alarm is
wired), or anything outside the team. If a request needs those, say exactly what is missing
and offer the closest workable plugin, setting its "heuristic" field to explain the gap.
Never fake data.`;
