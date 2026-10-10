import { expect, test } from "bun:test";
import { Validate } from "@better-rust/dsl";
import { handler, parseDuration } from "./Rpc.ts";

const plugin = await Bun.file(new URL("../../dsl/starter/pop.json", import.meta.url)).json();

const serve = () => {
  const proposed: string[] = [];

  const h = handler({
    token: () => "t0k",
    world: () => ({ ...Validate.emptyWorld, now: 100 }),
    bindings: () => [],
    recorded: () => [
      { at: 100, kind: "world", json: JSON.stringify({ ...Validate.emptyWorld, now: 100 }) },
    ],
    propose: async (r) => {
      proposed.push(r.plugin.name);

      return "awaiting confirmation";
    },
  });

  return {
    proposed,
    call: (path: string, init: RequestInit = {}, token = "t0k") =>
      h(new Request(`http://x${path}`, { ...init, headers: { authorization: `Bearer ${token}` } })),
  };
};

test("rejects bad tokens", async () => {
  expect((await serve().call("/v1/team", {}, "nope")).status).toBe(401);
});

test("live data, dry-run and propose", async () => {
  const s = serve();

  const post = (path: string, body: Parameters<typeof JSON.stringify>[0]) =>
    s.call(path, { method: "POST", body: JSON.stringify(body) });

  expect(await (await s.call("/v1/team")).json()).toEqual([]);
  expect((await post("/v1/dry-run", { plugin, from: "1h" })).status).toBe(200);
  expect((await post("/v1/dry-run", { plugin: { name: "x" } })).status).toBe(422);
  expect(await (await post("/v1/propose", { plugin })).json()).toEqual({
    status: "awaiting confirmation",
  });
  expect(s.proposed).toEqual(["pop"]);
});

test("parseDuration", () => {
  expect([parseDuration("2h"), parseDuration("30m"), parseDuration("x")]).toEqual([
    7200,
    1800,
    undefined,
  ]);
});
