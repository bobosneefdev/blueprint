import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Validate } from "@better-rust/dsl";
import { Effect, Ref } from "effect";
import protobuf from "protobufjs";
import * as Db from "./Db.ts";
import type * as Runtime from "./Runtime.ts";
import * as RustPlus from "./RustPlus.ts";
import * as Server from "./Server.ts";

const root = await protobuf.load(
  fileURLToPath(new URL("../proto/rustplus.proto", import.meta.url)),
);

const AppRequest = root.lookupType("rustplus.AppRequest");

const AppMessage = root.lookupType("rustplus.AppMessage");

/** Fake server: cargo appears on the 2nd marker poll; records team chat the bot sends. */
const fakeServer = (onChat: (text: string) => void) => {
  let markerPolls = 0;

  return Bun.serve({
    port: 0,
    fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no")),
    websocket: {
      message(ws, data) {
        // SAFETY: rustplus clients only send binary frames.
        const req = AppRequest.toObject(AppRequest.decode(data as Uint8Array), { longs: String });
        const seq = req.seq;

        const response = req.getInfo
          ? { seq, info: { name: "Fake", mapSize: 4500, wipeTime: 1 } }
          : req.getTime
            ? { seq, time: { time: 12, sunrise: 7, sunset: 20 } }
            : req.getTeamInfo
              ? {
                  seq,
                  teamInfo: {
                    members: [{ steamId: "1", name: "Bob", isOnline: true, isAlive: true }],
                  },
                }
              : req.getMapMarkers
                ? {
                    seq,
                    mapMarkers: {
                      markers: ++markerPolls >= 2 ? [{ id: 9, type: 5, x: 1000, y: 4000 }] : [],
                    },
                  }
                : { seq, success: {} };

        if (req.sendTeamMessage) onChat(req.sendTeamMessage.message);

        ws.send(AppMessage.encode(AppMessage.fromObject({ response })).finish());
      },
    },
  });
};

test("poll -> diff -> plugin -> team chat, end to end over a websocket", async () => {
  let resolveChat: (text: string) => void = () => {};

  const firstChat = new Promise<string>((r) => (resolveChat = r));
  const server = fakeServer((text) => resolveChat(text));

  const v = Validate.validate(
    await Bun.file(new URL("../../dsl/starter/cargo-alert.json", import.meta.url)).json(),
  );

  if (!v.ok) throw new Error("starter invalid");

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const rp = yield* RustPlus.make({
          ip: "127.0.0.1",
          port: server.port ?? 0,
          playerId: "1",
          playerToken: 1,
        });

        yield* Server.run({
          serverId: "fake",
          db: Db.open(":memory:"),
          rp,
          plugins: yield* Ref.make<ReadonlyArray<Runtime.Installed>>([
            { plugin: v.plugin, enabled: true },
          ]),
          bindings: yield* Ref.make<ReadonlyArray<Server.Binding>>([]),
          onAgentMessage: () => Effect.void,
          notify: () => Effect.void,
          onWipe: () => Effect.void,
          onActivity: () => {},
          isAgentMessage: () => false,
          botPrefix: "[bot] ",
          pollSeconds: 0.05,
        });

        return yield* Effect.promise(() => firstChat).pipe(Effect.timeout("3 seconds"));
      }),
    ),
  ).then((text) => {
    server.stop(true);
    expect(text).toBe("[bot] Cargo Ship spawned at G3");
  });
});
