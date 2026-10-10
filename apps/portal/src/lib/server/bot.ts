// The portal runs inside the bot process. The bot entry calls `attach` at startup; routes read
// live state through `bot()`. Keeping it one narrow interface keeps the portal testable.
import type { Plugin, World } from "@better-rust/dsl";

export interface PluginRow {
  readonly plugin: Plugin;
  readonly enabled: boolean;
  readonly history: ReadonlyArray<{
    readonly commit: string;
    readonly at: string;
    readonly message: string;
  }>;
}

export interface Bot {
  readonly sessionSecret: string;
  readonly hostSteamId: string;
  readonly allowlist: () => ReadonlyArray<string>;
  readonly publicUrl: () => string;
  readonly servers: () => ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly world: World | undefined;
  }>;
  readonly plugins: () => ReadonlyArray<PluginRow>;
  readonly setEnabled: (name: string, enabled: boolean, by: string) => Promise<void>;
  readonly rollback: (name: string, commit: string, by: string) => Promise<void>;
  readonly diff: (name: string, commit: string) => string;
  readonly reply: (id: string) => string | undefined;
  readonly pairing: () => { readonly signedIn: boolean; readonly hostSteamId: string };
  /** Opens Steam sign-in on the host PC; resolves with the signed-in SID64. */
  readonly pair: () => Promise<string>;
  readonly settings: () => Settings;
  /** Host PC only: stores a harness credential inside the sandbox. */
  readonly saveHarnessCredential: (c: HarnessCredential) => Promise<void>;
  /** Most recent first. */
  readonly activity: () => ReadonlyArray<{
    readonly at: number;
    readonly server: string;
    readonly plugin: string;
    readonly message: string;
  }>;
  /** Host only. */
  readonly saveSettings: (s: Settings) => Promise<void>;
  /** Validates, then activates a plugin from a URL (gallery import). Returns problems if invalid. */
  readonly importPlugin: (url: string, by: string) => Promise<ReadonlyArray<string>>;
}

export type HarnessCredential =
  | { readonly harness: "claude"; readonly kind: "oauthToken" | "apiKey"; readonly value: string }
  | { readonly harness: "codex"; readonly kind: "apiKey"; readonly value: string }
  | { readonly harness: "pi"; readonly envVar: string; readonly value: string };

export interface Settings {
  readonly botName: string;
  readonly allowlist: ReadonlyArray<string>;
  readonly harness: "claude" | "codex" | "pi";
  readonly model: string | undefined;
  readonly ntfyTopic: string | undefined;
}

// The portal is bundled separately from the bot, so module state is not shared; a global is the
// one slot both bundles can see.
declare global {
  var __betterRustBot: Bot | undefined;
}

export const attach = (b: Bot) => {
  globalThis.__betterRustBot = b;
};

export const bot = (): Bot => {
  const current = globalThis.__betterRustBot;

  if (current === undefined) throw new Error("portal started without a bot attached");

  return current;
};
