// Host-side Rust+ sign-in. Opens Facepunch's /login page in the system Edge (shipped with every
// Windows install). Their third-party warning is shown as-is and the player clicks Continue
// themselves; we only provide the ReactNativeWebView.postMessage hook the page calls with the token.
//
// Raw Chrome DevTools Protocol instead of playwright: playwright-core cannot be bundled by
// `bun build --compile`, and we only need two calls (addBinding + addScriptToEvaluateOnNewDocument).
import { Pairing } from "@better-rust/core";
import { Schema } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const Auth = Schema.Struct({
  SteamId: Schema.Union([Schema.String, Schema.Number]),
  Token: Schema.String,
});

const decodeAuth = Schema.decodeUnknownSync(Schema.fromJsonString(Auth));

const Targets = Schema.Array(
  Schema.Struct({ type: Schema.String, webSocketDebuggerUrl: Schema.optionalKey(Schema.String) }),
);

const decodeTargets = Schema.decodeUnknownSync(Schema.fromJsonString(Targets));

const CdpMessage = Schema.Struct({
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      payload: Schema.optionalKey(Schema.String),
    }),
  ),
});

const decodeCdp = Schema.decodeUnknownSync(Schema.fromJsonString(CdpMessage));

const edgePath = () =>
  process.env.BROWSER_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : "chromium");

/** Page-side hook: Facepunch's login page calls ReactNativeWebView.postMessage(JSON). */
const HOOK = `window.ReactNativeWebView = { postMessage: (m) => window.__rustplusAuth(m) };`;

const waitForPage = async (port: number) => {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const page = decodeTargets(await res.text()).find((t) => t.type === "page");

      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // browser still starting
    }

    await Bun.sleep(100);
  }

  throw new Error("browser did not start");
};

export const signIn = async (): Promise<{
  readonly steamId: string;
  readonly authToken: string;
}> => {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), "better-rust-login-"));

  const browser = Bun.spawn(
    [
      edgePath(),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );

  try {
    const ws = new WebSocket(await waitForPage(port));
    let id = 0;

    const send = (method: string, params: Record<string, string> = {}) =>
      ws.send(JSON.stringify({ id: ++id, method, params }));

    return await new Promise((resolve, reject) => {
      void browser.exited.then(() => reject(new Error("sign-in window closed")));
      ws.onerror = () => reject(new Error("lost connection to the browser"));
      ws.onmessage = (ev) => {
        const msg = decodeCdp(String(ev.data));

        if (msg.method !== "Runtime.bindingCalled" || msg.params?.name !== "__rustplusAuth") return;

        const a = decodeAuth(msg.params.payload ?? "");

        resolve({ steamId: String(a.SteamId), authToken: a.Token });
      };

      ws.onopen = () => {
        send("Runtime.enable");
        send("Runtime.addBinding", { name: "__rustplusAuth" });
        send("Page.enable");
        send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
        send("Page.navigate", { url: Pairing.LOGIN_URL });
      };
    });
  } finally {
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true });
  }
};
