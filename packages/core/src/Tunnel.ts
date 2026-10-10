// Cloudflare quick tunnel: `cloudflared tunnel --url http://127.0.0.1:<port>` prints a random
// https://<words>.trycloudflare.com URL to stderr. The URL changes on every start.
import { Deferred, Effect, Stream } from "effect";

export const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** Pulls the tunnel URL out of a cloudflared log line, if present. */
export const parseUrl = (line: string) => URL_PATTERN.exec(line)?.[0];

export class TunnelError extends Error {
  readonly _tag = "TunnelError";
}

/** Starts cloudflared for the scope's lifetime and resolves with the public URL. */
export const start = (cloudflared: string, port: number) =>
  Effect.gen(function* () {
    const url = yield* Deferred.make<string, TunnelError>();

    const proc = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn([cloudflared, "tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
          stdout: "ignore",
          stderr: "pipe",
        }),
      ),
      (p) => Effect.sync(() => p.kill()),
    );

    yield* Stream.fromReadableStream({
      evaluate: () => proc.stderr,
      onError: (e) => new TunnelError(String(e)),
    }).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => {
        const found = parseUrl(line);

        return found === undefined ? Effect.void : Deferred.succeed(url, found);
      }),
      Effect.andThen(
        Deferred.fail(url, new TunnelError("cloudflared exited before printing a URL")),
      ),
      Effect.forkScoped,
    );

    return yield* Deferred.await(url).pipe(
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () => Effect.fail(new TunnelError("timed out waiting for tunnel URL")),
      }),
    );
  });
