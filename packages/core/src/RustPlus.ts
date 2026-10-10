// Rust+ websocket client as an Effect service.
//
// Own client instead of rustplus.js's: we need typed request/response, per-request timeouts,
// broadcasts as a Stream, and the vendored proto (proto/rustplus.proto, every `required` made
// `optional` because newer servers omit fields like `queuedPlayers`).
import { Context, Data, Deferred, Effect, Layer, Queue, Ref, Stream } from "effect";
import protobuf from "protobufjs";

export interface ServerCredentials {
  readonly ip: string;
  readonly port: number;
  readonly playerId: string;
  readonly playerToken: number;
}

export class ConnectError extends Data.TaggedError("RustPlus.ConnectError")<{
  readonly cause: string;
}> {}

export class RequestError extends Data.TaggedError("RustPlus.RequestError")<{
  readonly request: string;
  readonly error: string;
}> {}

export class Timeout extends Data.TaggedError("RustPlus.Timeout")<{ readonly request: string }> {}

/** Keys of AppRequest that select an operation (exactly one per request). */
export type RequestKind =
  | "getInfo"
  | "getTime"
  | "getTeamInfo"
  | "getMapMarkers"
  | "getMap"
  | "getEntityInfo"
  | "setEntityValue"
  | "sendTeamMessage";

// Decoded protobuf messages. `toObject` with longs-as-strings gives plain JSON-ish data; these
// shapes mirror proto/rustplus.proto with every field optional.
export interface AppTeamMember {
  readonly steamId?: string;
  readonly name?: string;
  readonly x?: number;
  readonly y?: number;
  readonly isOnline?: boolean;
  readonly spawnTime?: number;
  readonly isAlive?: boolean;
  readonly deathTime?: number;
}

export interface AppTeamInfo {
  readonly leaderSteamId?: string;
  readonly members?: ReadonlyArray<AppTeamMember>;
}

export interface AppMarker {
  readonly id?: number;
  readonly type?: number;
  readonly x?: number;
  readonly y?: number;
  readonly name?: string;
}

export interface AppInfo {
  readonly name?: string;
  readonly mapSize?: number;
  readonly wipeTime?: number;
  readonly players?: number;
  readonly maxPlayers?: number;
  readonly queuedPlayers?: number;
  readonly seed?: number;
}

export interface AppTime {
  readonly time?: number;
  readonly sunrise?: number;
  readonly sunset?: number;
}

export interface AppEntityInfo {
  readonly type?: number;
  readonly payload?: { readonly value?: boolean };
}

export interface AppResponse {
  readonly seq?: number;
  readonly error?: { readonly error?: string };
  readonly info?: AppInfo;
  readonly time?: AppTime;
  readonly teamInfo?: AppTeamInfo;
  readonly mapMarkers?: { readonly markers?: ReadonlyArray<AppMarker> };
  readonly entityInfo?: AppEntityInfo;
  /** jpgImage is base64 (protobufjs toObject bytes default). */
  readonly map?: {
    readonly width?: number;
    readonly height?: number;
    readonly jpgImage?: string;
    readonly oceanMargin?: number;
  };
}

export interface AppBroadcast {
  readonly teamChanged?: { readonly playerId?: string; readonly teamInfo?: AppTeamInfo };
  readonly teamMessage?: {
    readonly message?: {
      readonly steamId?: string;
      readonly name?: string;
      readonly message?: string;
    };
  };
  readonly entityChanged?: {
    readonly entityId?: number;
    readonly payload?: { readonly value?: boolean };
  };
}

export interface Interface {
  readonly request: (
    kind: RequestKind,
    body?: { readonly entityId?: number; readonly value?: boolean; readonly message?: string },
  ) => Effect.Effect<AppResponse, RequestError | Timeout>;
  readonly broadcasts: Stream.Stream<AppBroadcast>;
}

export class Service extends Context.Service<Service, Interface>()("@better-rust/RustPlus") {}

const protoPath = new URL("../proto/rustplus.proto", import.meta.url).pathname.replace(
  /^\/([A-Z]:)/,
  "$1",
);

const toObjectOptions = { longs: String, enums: Number, bytes: String, defaults: false } as const;

const bodyFor = (kind: RequestKind, body: Parameters<Interface["request"]>[1]) => {
  switch (kind) {
    case "setEntityValue":
      return { entityId: body?.entityId, setEntityValue: { value: body?.value ?? false } };
    case "getEntityInfo":
      return { entityId: body?.entityId, getEntityInfo: {} };
    case "sendTeamMessage":
      return { sendTeamMessage: { message: body?.message ?? "" } };
    default:
      return { [kind]: {} };
  }
};

/** Opens one websocket for the lifetime of the scope. Requests are matched to responses by seq. */
export const make = (creds: ServerCredentials, opts?: { readonly timeoutMs?: number }) =>
  Effect.gen(function* () {
    const root = yield* Effect.tryPromise({
      try: () => protobuf.load(protoPath),
      catch: (e) => new ConnectError({ cause: `proto: ${String(e)}` }),
    });

    const AppRequest = root.lookupType("rustplus.AppRequest");
    const AppMessage = root.lookupType("rustplus.AppMessage");
    const pending = yield* Ref.make(new Map<number, Deferred.Deferred<AppResponse>>());
    const broadcasts = yield* Queue.unbounded<AppBroadcast>();
    const seq = yield* Ref.make(0);

    const ws = yield* Effect.acquireRelease(
      Effect.callback<WebSocket, ConnectError>((resume) => {
        const socket = new WebSocket(`ws://${creds.ip}:${creds.port}`);

        socket.binaryType = "arraybuffer";
        socket.onopen = () => resume(Effect.succeed(socket));
        socket.onerror = () => resume(Effect.fail(new ConnectError({ cause: "websocket error" })));
      }),
      (socket) => Effect.sync(() => socket.close()),
    );

    const runtime = yield* Effect.context<never>();

    ws.onmessage = (ev) => {
      // SAFETY: binaryType is arraybuffer, so data is always an ArrayBuffer.
      const msg = AppMessage.toObject(
        AppMessage.decode(new Uint8Array(ev.data as ArrayBuffer)),
        toObjectOptions,
      );

      const response: AppResponse | undefined = msg.response;
      const broadcast: AppBroadcast | undefined = msg.broadcast;

      Effect.runForkWith(runtime)(
        Effect.gen(function* () {
          if (broadcast) yield* Queue.offer(broadcasts, broadcast);

          if (response?.seq !== undefined) {
            const waiters = yield* Ref.get(pending);
            const d = waiters.get(response.seq);

            if (d) yield* Deferred.succeed(d, response);
          }
        }),
      );
    };

    const request = Effect.fn("RustPlus.request")(function* (
      kind: RequestKind,
      body?: Parameters<Interface["request"]>[1],
    ) {
      const n = yield* Ref.updateAndGet(seq, (x) => x + 1);
      const d = yield* Deferred.make<AppResponse>();

      yield* Ref.update(pending, (m) => new Map(m).set(n, d));

      const payload = AppRequest.fromObject({
        seq: n,
        playerId: creds.playerId,
        playerToken: creds.playerToken,
        ...bodyFor(kind, body),
      });

      ws.send(Uint8Array.from(AppRequest.encode(payload).finish()));

      const response: AppResponse = yield* Deferred.await(d).pipe(
        Effect.timeoutOrElse({
          duration: opts?.timeoutMs ?? 10_000,
          orElse: () => Effect.fail(new Timeout({ request: kind })),
        }),
        Effect.ensuring(
          Ref.update(pending, (m) => {
            const next = new Map(m);

            next.delete(n);

            return next;
          }),
        ),
      );

      if (response.error?.error)
        return yield* new RequestError({ request: kind, error: response.error.error });

      return response;
    });

    return Service.of({ request, broadcasts: Stream.fromQueue(broadcasts) });
  });

export const layer = (creds: ServerCredentials) => Layer.effect(Service, make(creds));
