import { expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import protobuf from "protobufjs";
import * as RustPlus from "./RustPlus.ts";

const root = await protobuf.load(new URL("../proto/rustplus.proto", import.meta.url).pathname);

const AppRequest = root.lookupType("rustplus.AppRequest");

const AppMessage = root.lookupType("rustplus.AppMessage");

/** Minimal fake Rust server: answers getInfo (without queuedPlayers), errors on getTime. */
const fakeServer = () =>
  Bun.serve({
    port: 0,
    fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no")),
    websocket: {
      message(ws, data) {
        // SAFETY: rustplus clients only send binary frames.
        const req = AppRequest.toObject(AppRequest.decode(data as Uint8Array), { longs: String });

        const response = req.getInfo
          ? { seq: req.seq, info: { name: "Test Server", mapSize: 4000, wipeTime: 1, players: 3 } }
          : { seq: req.seq, error: { error: "no_player" } };

        ws.send(AppMessage.encode(AppMessage.fromObject({ response })).finish());

        if (req.sendTeamMessage)
          ws.send(
            AppMessage.encode(
              AppMessage.fromObject({
                broadcast: {
                  teamMessage: { message: { name: "bot", message: req.sendTeamMessage.message } },
                },
              }),
            ).finish(),
          );
      },
    },
  });

test("request/response by seq, typed errors, broadcasts, tolerant decode", async () => {
  const server = fakeServer();

  const creds = {
    ip: "127.0.0.1",
    port: server.port ?? 0,
    playerId: "76561198000000000",
    playerToken: 1,
  };

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const rp = yield* RustPlus.make(creds, { timeoutMs: 2000 });
        const info = yield* rp.request("getInfo");
        const err = yield* Effect.flip(rp.request("getTime"));

        yield* Effect.ignore(rp.request("sendTeamMessage", { message: "hello" }));

        const echoed = yield* rp.broadcasts.pipe(Stream.take(1), Stream.runCollect);

        return {
          info: info.info,
          err: err._tag,
          echoed: [...echoed][0]?.teamMessage?.message?.message,
        };
      }),
    ),
  );

  server.stop(true);
  expect(result).toEqual({
    info: { name: "Test Server", mapSize: 4000, wipeTime: 1, players: 3 },
    err: "RustPlus.RequestError",
    echoed: "hello",
  });
});
