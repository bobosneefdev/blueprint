// Rust+ pairing, verified in spikes/rustplus-pair (real Steam login + push register, 2026-10-10).
//
// 1. registerDevice: FCM (Rust+ Android identity) + Expo push token.
// 2. Steam login happens in a host-side browser on Facepunch's /login page (their third-party
//    warning, player clicks); the page hands back {SteamId, Token} via ReactNativeWebView.
// 3. registerPush: tells Facepunch where to send pair notifications.
// 4. listen: in-game "Pair with Server" / "Pair" on devices arrive as FCM data messages.
// Ambient `declare module` files cannot be imported; a reference is the only way consumers see them.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./push-receiver.d.ts" />
import AndroidFCM from "@liamcottle/push-receiver/src/android/fcm";
import PushReceiverClient from "@liamcottle/push-receiver/src/client";
import { Option, Schema } from "effect";

const COMPANION = "https://companion-rust.facepunch.com";

export const LOGIN_URL = `${COMPANION}/login`;

export interface Device {
  readonly fcm: { readonly androidId: string; readonly securityToken: string };
  readonly expoPushToken: string;
}

// Facepunch's Rust+ Android app identity, as used by rustplus.js `fcm-register`.
export const registerDevice = async (): Promise<Device> => {
  const creds = await AndroidFCM.register(
    "AIzaSyB5y2y-Tzqb4-I4Qnlsh_9naYv_TD8pCvY",
    "rust-companion-app",
    "976529667804",
    "1:976529667804:android:d6f1ddeb4403b338fea619",
    "com.facepunch.rust.companion",
    "E28D05345FB78A7A1A63D70F4A302DBF426CA5AD",
  );

  const res = await fetch("https://exp.host/--/api/v2/push/getExpoPushToken", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "fcm",
      deviceId: crypto.randomUUID(),
      development: false,
      appId: "com.facepunch.rust.companion",
      deviceToken: creds.fcm.token,
      projectId: "49451aca-a822-41e6-ad59-955718d0ff9c",
    }),
  });

  if (!res.ok) throw new Error(`expo push token ${res.status}`);

  const expo = Schema.decodeUnknownSync(
    Schema.Struct({ data: Schema.Struct({ expoPushToken: Schema.String }) }),
  )(await res.json());

  return {
    fcm: { androidId: String(creds.gcm.androidId), securityToken: String(creds.gcm.securityToken) },
    expoPushToken: expo.data.expoPushToken,
  };
};

/** The Rust+ auth token expires (~2 weeks); a 401/403 here means the host must sign in again. */
export const registerPush = async (authToken: string, expoPushToken: string) => {
  const res = await fetch(`${COMPANION}/api/push/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      AuthToken: authToken,
      DeviceId: "blueprint",
      PushKind: 3,
      PushToken: expoPushToken,
    }),
  });

  if (!res.ok) throw new Error(`push register ${res.status}`);
};

const ServerPair = Schema.Struct({
  type: Schema.Literal("server"),
  id: Schema.String,
  name: Schema.String,
  ip: Schema.String,
  port: Schema.NumberFromString,
  playerId: Schema.String,
  playerToken: Schema.NumberFromString,
});

const EntityPair = Schema.Struct({
  type: Schema.Literal("entity"),
  id: Schema.String,
  ip: Schema.String,
  port: Schema.NumberFromString,
  entityId: Schema.NumberFromString,
  entityType: Schema.NumberFromString,
  entityName: Schema.optionalKey(Schema.String),
});

export const PairNotification = Schema.Union([ServerPair, EntityPair]);

export type PairNotification = typeof PairNotification.Type;

const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(PairNotification));

/** FCM data message -> pairing notification, if it is one. */
export const parseNotification = (appData: ReadonlyArray<{ key: string; value: string }>) =>
  Option.getOrUndefined(decodeBody(appData.find((d) => d.key === "body")?.value ?? ""));

/** Long-lived FCM listener. Returns a stop function. */
export const listen = (
  device: Device,
  persistentIds: ReadonlyArray<string>,
  onPair: (n: PairNotification, persistentId: string) => void,
) => {
  const client = new PushReceiverClient(device.fcm.androidId, device.fcm.securityToken, [
    ...persistentIds,
  ]);

  client.on(
    "ON_DATA_RECEIVED",
    (data: { persistentId: string; appData: Array<{ key: string; value: string }> }) => {
      const n = parseNotification(data.appData);

      if (n !== undefined) onPair(n, data.persistentId);
    },
  );
  void client.connect();

  return () => client.destroy();
};
