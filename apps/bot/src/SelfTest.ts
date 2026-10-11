// `blueprint-bot.exe --self-test`: runs the parts of pairing that load bundled files, inside the
// compiled exe. Release CI runs it from outside the checkout, so a runtime path baked in from the
// build machine fails the build instead of a player's "Sign in with Steam".
import { Pairing, RustPlus } from "@blueprint/core";
import { Effect } from "effect";

const step = async (name: string, run: () => Promise<void>) => {
  try {
    await run();
    console.log(`ok   ${name}`);

    return true;
  } catch (e) {
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);

    return false;
  }
};

export const run = async () => {
  const results = [
    await step("push-receiver mcs.proto", Pairing.loadProtos),
    // FCM checkin loads the gcm protos; network errors are fine, ENOENT is not.
    await step("push-receiver checkin.proto", () =>
      Pairing.registerDevice().then(
        () => undefined,
        (e: Error) => {
          if (e.message.includes("ENOENT")) throw e;
        },
      ),
    ),
    await step("rustplus.proto", () =>
      Effect.runPromise(
        Effect.scoped(
          RustPlus.make(
            { ip: "127.0.0.1", port: 1, playerId: "1", playerToken: 1 },
            { timeoutMs: 1000 },
          ),
        ).pipe(
          Effect.asVoid,
          Effect.catch((e) => (String(e.cause).startsWith("proto") ? Effect.fail(e) : Effect.void)),
        ),
      ),
    ),
    // A SteamID rounded to a double makes every Rust+ request fail (blank server cards).
    await step("uint64 SteamID round-trip", async () => {
      if (!RustPlus.uint64RoundTrips("76561198012345679")) throw new Error("rounded");
    }),
  ];

  process.exit(results.every(Boolean) ? 0 : 1);
};
