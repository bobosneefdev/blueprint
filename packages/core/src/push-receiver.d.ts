// Minimal types for the parts of @liamcottle/push-receiver we call (untyped JS upstream).
declare module "@liamcottle/push-receiver/src/android/fcm" {
  const AndroidFCM: {
    register(
      apiKey: string,
      projectId: string,
      gcmSenderId: string,
      gmsAppId: string,
      androidPackageName: string,
      androidPackageCert: string,
    ): Promise<{
      gcm: { androidId: string | number; securityToken: string | number };
      fcm: { token: string };
    }>;
  };

  export default AndroidFCM;
}

declare module "@liamcottle/push-receiver/src/client" {
  export default class PushReceiverClient {
    constructor(androidId: string, securityToken: string, persistentIds: string[]);
    on(
      event: "ON_DATA_RECEIVED",
      cb: (data: { persistentId: string; appData: Array<{ key: string; value: string }> }) => void,
    ): void;
    connect(): Promise<void>;
    destroy(): void;
  }
}
