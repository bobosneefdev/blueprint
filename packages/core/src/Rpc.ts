// HTTP API the sandboxed `bot` CLI talks to. Bound to the WSL-facing interface only, bearer-token
// authenticated with a per-job token that also identifies who asked. Everything is JSON.
import { Validate, type World } from "@blueprint/dsl";
import { Option, Schema } from "effect";
import * as Replay from "./Replay.ts";

export interface Deps {
  /** Bearer token -> requester SID64. One token per running agent job. */
  readonly requesterFor: (token: string) => string | undefined;
  readonly world: (server: string | undefined) => World | undefined;
  readonly bindings: (server: string | undefined) => ReadonlyArray<{ name: string; kind: string }>;
  readonly recorded: (
    server: string | undefined,
    fromSeconds: number,
  ) => ReadonlyArray<Replay.Recorded>;
  /** Posts the confirm prompt to team chat; resolves when queued, not when confirmed. */
  readonly propose: (requester: string, plugin: Validate.Result & { ok: true }) => Promise<string>;
}

const json: (status: number, body: Parameters<typeof Response.json>[0]) => Response = (
  status,
  body,
) => Response.json(body, { status });

/** "2h" | "30m" | "90s" -> seconds. */
export const parseDuration = (s: string): number | undefined => {
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim());

  if (!m?.[1] || !m[2]) return undefined;

  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] ?? 1;

  return Number(m[1]) * unit;
};

const Body = Schema.Struct({ plugin: Schema.Json, from: Schema.optionalKey(Schema.String) });

const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(Body));

const pluginFrom = async (req: Request) =>
  Option.match(decodeBody(await req.text()), {
    onNone: () => ({ result: Validate.validate(null), from: undefined }),
    onSome: (b) => ({ result: Validate.validate(b.plugin), from: b.from }),
  });

export const handler =
  (deps: Deps) =>
  async (req: Request): Promise<Response> => {
    const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const requester = token === undefined ? undefined : deps.requesterFor(token);

    if (requester === undefined) return json(401, { error: "unauthorized" });

    const url = new URL(req.url);
    const server = url.searchParams.get("server") ?? undefined;
    const world = deps.world(server);

    switch (`${req.method} ${url.pathname}`) {
      case "GET /v1/team":
        return world ? json(200, world.team) : json(503, { error: "no data yet" });
      case "GET /v1/markers":
        return world ? json(200, world.markers) : json(503, { error: "no data yet" });
      case "GET /v1/info":
        return world
          ? json(200, { server: world.server, time: world.time })
          : json(503, { error: "no data yet" });
      case "GET /v1/devices":
        return json(200, { bindings: deps.bindings(server), devices: world?.devices ?? [] });
      case "POST /v1/dry-run": {
        const { result, from } = await pluginFrom(req);

        if (!result.ok) return json(422, { problems: result.problems });

        const seconds = parseDuration(from ?? "2h");

        if (seconds === undefined) return json(400, { error: "from must look like 2h, 30m, 90s" });

        const now = Math.floor(Date.now() / 1000);
        const report = Replay.replay(result.plugin, deps.recorded(server, now - seconds));

        return json(200, { ...report, fired: report.fired.slice(0, 50) });
      }

      case "POST /v1/propose": {
        const { result } = await pluginFrom(req);

        if (!result.ok) return json(422, { problems: result.problems });

        return json(200, { status: await deps.propose(requester, result) });
      }

      default:
        return json(404, { error: "not found" });
    }
  };
