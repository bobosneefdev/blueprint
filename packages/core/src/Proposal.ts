// Agent-proposed plugins awaiting the requester's "@bot yes <code>".
//
// The agent writes the plugin's name/description, so the prompt shows facts the bot derives
// itself (what the plugin does to the world, whether it replaces something) plus a portal link
// to the full JSON. A per-proposal code means a stale or spoofed "[bot] reply yes" can't confirm
// a different plugin, and a proposal expires after a few minutes.
import { Action, type Plugin } from "@blueprint/dsl";

export const TTL_MS = 10 * 60_000;

export interface Pending {
  readonly plugin: Plugin;
  readonly code: string;
  readonly expires: number;
}

/** What the plugin can do outside the bot, derived from its actions (never from its own text). */
export const effects = (plugin: Plugin) => {
  const kinds = new Set(
    plugin.steps.flatMap((s) =>
      s.actions.map((a) =>
        Action.match(a, {
          TeamChat: () => "chat",
          Notify: () => "notify",
          SmartSwitch: (x) => `switch:${x.binding}`,
          SetState: () => "",
        }),
      ),
    ),
  );

  kinds.delete("");

  return [...kinds].sort();
};

export const makeCode = (random = Math.random) => String(Math.floor(1000 + random() * 9000));

/** Rust team chat line limit minus the "[bot] " prefix. */
const LINE = 122;

/**
 * Two chat lines: the confirm instruction + link first (must never be truncated), then the
 * derived summary, which may be cut if a plugin has many effects.
 */
export const prompt = (p: Pending, replaces: Plugin | undefined, link: string, botName: string) => {
  const what = effects(p.plugin).join(",") || "state only";

  const action = replaces
    ? `REPLACES ${replaces.name} v${replaces.version}`
    : `new ${p.plugin.name}`;

  return [`@${botName} yes ${p.code} to activate: ${link}`, `${action} [${what}]`.slice(0, LINE)];
};

export type Confirm =
  | { readonly kind: "none" }
  | { readonly kind: "expired" }
  | { readonly kind: "wrongCode" }
  | { readonly kind: "ok"; readonly plugin: Plugin };

export const confirm = (p: Pending | undefined, code: string | undefined, now: number): Confirm => {
  if (p === undefined) return { kind: "none" };

  if (now > p.expires) return { kind: "expired" };

  if (code !== p.code) return { kind: "wrongCode" };

  return { kind: "ok", plugin: p.plugin };
};
