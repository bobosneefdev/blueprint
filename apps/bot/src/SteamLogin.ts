// Host-side Rust+ sign-in. Opens Facepunch's /login page in the system Edge (shipped with every
// Windows install). Their third-party warning is shown as-is and the player clicks Continue
// themselves; we only provide the ReactNativeWebView.postMessage hook the page calls with the token.
import { Pairing } from "@better-rust/core";
import { Schema } from "effect";
import { chromium } from "playwright-core";

const Auth = Schema.Struct({
  SteamId: Schema.Union([Schema.String, Schema.Number]),
  Token: Schema.String,
});

const decodeAuth = Schema.decodeUnknownSync(Schema.fromJsonString(Auth));

declare global {
  interface Window {
    __rustplusAuth: (message: string) => void;
  }
}

export const signIn = async (): Promise<{
  readonly steamId: string;
  readonly authToken: string;
}> => {
  const browser = await chromium.launch({
    headless: false,
    ...(process.env.BROWSER_PATH === undefined
      ? { channel: "msedge" }
      : { executablePath: process.env.BROWSER_PATH }),
  });

  try {
    const page = await browser.newPage();

    const auth = new Promise<{ steamId: string; authToken: string }>((resolve, reject) => {
      page.on("close", () => reject(new Error("sign-in window closed")));
      void page.exposeBinding("__rustplusAuth", (_src, msg: string) => {
        const a = decodeAuth(msg);

        resolve({ steamId: String(a.SteamId), authToken: a.Token });
      });
    });

    await page.addInitScript(() => {
      Object.assign(window, {
        ReactNativeWebView: {
          // Runs in the page, after exposeBinding above installed __rustplusAuth.
          postMessage: (m: string) => window.__rustplusAuth(m),
        },
      });
    });
    await page.goto(Pairing.LOGIN_URL);

    return await auth;
  } finally {
    await browser.close();
  }
};
