// Spike 1: Rust+ pairing + team chat round trip, end to end, from Bun.
//
//   bun pair.ts register   FCM + Expo + Steam login (browser) + Rust+ push register
//   bun pair.ts listen     wait for in-game "Pair with Server" notification, then chat round trip
//
// State lives in ./state.json (gitignored: contains Rust+ auth + FCM credentials).
import AndroidFCM from "@liamcottle/push-receiver/src/android/fcm";
import PushReceiverClient from "@liamcottle/push-receiver/src/client";
import RustPlus from "@liamcottle/rustplus.js";
import { chromium } from "playwright-core";

const STATE = new URL("./state.json", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const COMPANION = "https://companion-rust.facepunch.com";

type State = {
  fcm: { gcm: { androidId: string; securityToken: string }; fcm: { token: string } };
  expoPushToken: string;
  steamId: string;
  authToken: string;
  persistentIds: string[];
  server?: { ip: string; port: string; playerId: string; playerToken: string; name: string };
};

const load = async (): Promise<State> => Bun.file(STATE).json();
const save = (s: State) => Bun.write(STATE, JSON.stringify(s, null, 2));

// Facepunch's Rust+ Android app identity, as used by rustplus.js `fcm-register`.
const registerFcm = () =>
  AndroidFCM.register(
    "AIzaSyB5y2y-Tzqb4-I4Qnlsh_9naYv_TD8pCvY",
    "rust-companion-app",
    "976529667804",
    "1:976529667804:android:d6f1ddeb4403b338fea619",
    "com.facepunch.rust.companion",
    "E28D05345FB78A7A1A63D70F4A302DBF426CA5AD",
  );

async function expoToken(fcmToken: string): Promise<string> {
  const res = await fetch("https://exp.host/--/api/v2/push/getExpoPushToken", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "fcm",
      deviceId: crypto.randomUUID(),
      development: false,
      appId: "com.facepunch.rust.companion",
      deviceToken: fcmToken,
      projectId: "49451aca-a822-41e6-ad59-955718d0ff9c",
    }),
  });
  if (!res.ok) throw new Error(`expo ${res.status}`);
  return (await res.json()).data.expoPushToken;
}

// Steam login through Facepunch's own /login page (which shows the mandatory third-party warning;
// the player presses Continue themselves). On success the page calls
// window.ReactNativeWebView.postMessage({SteamId, Token}) — we provide that object via an init
// script, so no --disable-web-security is needed (unlike rustplus.js's pair.html).
async function steamLogin(): Promise<{ steamId: string; authToken: string }> {
  // Edge ships with every Windows install, so no browser download is needed.
  const browser = await chromium.launch({
    headless: false,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : { channel: "msedge" }),
  });
  const page = await browser.newPage();
  const result = new Promise<{ steamId: string; authToken: string }>((resolve) =>
    page.exposeBinding("__rustplusAuth", (_src, msg: string) => {
      const auth = JSON.parse(msg);
      resolve({ steamId: String(auth.SteamId), authToken: auth.Token });
    }),
  );
  await page.addInitScript(() => {
    // @ts-expect-error injected page global
    window.ReactNativeWebView = { postMessage: (m: string) => window.__rustplusAuth(m) };
  });
  await page.goto(`${COMPANION}/login`);
  console.log("Browser open: press 'Login with Steam' and sign in.");
  const auth = await result;
  await browser.close();
  return auth;
}

async function pushRegister(authToken: string, expoPushToken: string) {
  const res = await fetch(`${COMPANION}/api/push/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      AuthToken: authToken,
      DeviceId: "better-rust",
      PushKind: 3,
      PushToken: expoPushToken,
    }),
  });
  if (!res.ok) throw new Error(`push/register ${res.status}: ${await res.text()}`);
}

async function register() {
  const fcm = await registerFcm();
  console.log("FCM registered");
  const expoPushToken = await expoToken(fcm.fcm.token);
  console.log("Expo token ok");
  const { steamId, authToken } = await steamLogin();
  console.log(`Steam linked: ${steamId}`);
  await pushRegister(authToken, expoPushToken);
  console.log("Rust+ push registered");
  await save({ fcm, expoPushToken, steamId, authToken, persistentIds: [] });
  console.log(
    `Saved ${STATE}. Next: bun pair.ts listen, then in game ESC > Rust+ > Pair with Server.`,
  );
}

function roundTrip(server: NonNullable<State["server"]>) {
  const rp = new RustPlus(server.ip, server.port, server.playerId, Number(server.playerToken));
  rp.on("connected", () => {
    console.log(`Connected to ${server.name}`);
    rp.getInfo((m: { response: unknown }) =>
      console.log("getInfo:", JSON.stringify(m.response).slice(0, 200)),
    );
    rp.sendTeamMessage("[better-rust spike] hello. Reply in team chat to test receive.");
  });
  rp.on(
    "message",
    (m: { broadcast?: { teamMessage?: { message: { name: string; message: string } } } }) => {
      const t = m.broadcast?.teamMessage?.message;
      if (t) console.log(`team chat <- ${t.name}: ${t.message}`);
    },
  );
  rp.on("error", (e: Error) => console.error("ws error:", e.message));
  rp.on("disconnected", () => console.log("disconnected"));
  rp.connect();
}

async function listen() {
  const state = await load();
  if (state.server) return roundTrip(state.server);
  const client = new PushReceiverClient(
    state.fcm.gcm.androidId,
    state.fcm.gcm.securityToken,
    state.persistentIds,
  );
  client.on(
    "ON_DATA_RECEIVED",
    async (data: { persistentId: string; appData: { key: string; value: string }[] }) => {
      state.persistentIds.push(data.persistentId);
      const body = data.appData.find((d) => d.key === "body")?.value;
      const parsed = body ? JSON.parse(body) : null;
      console.log("push:", parsed?.type, parsed?.name ?? "", parsed?.entityName ?? "");
      if (parsed?.type === "server") {
        state.server = {
          ip: parsed.ip,
          port: parsed.port,
          playerId: parsed.playerId,
          playerToken: parsed.playerToken,
          name: parsed.name,
        };
        await save(state);
        roundTrip(state.server);
      } else await save(state);
    },
  );
  await client.connect();
  console.log("Listening. In game: ESC > Rust+ > Pair with Server.");
}

const cmd = process.argv[2];
if (cmd === "register") await register();
else if (cmd === "listen") await listen();
else console.log("usage: bun pair.ts register|listen");
