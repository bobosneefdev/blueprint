import { expect, test } from "bun:test";
import { Validate } from "@better-rust/dsl";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUrl } from "./Tunnel.ts";
import * as Workspace from "./Workspace.ts";

const starter = async (name: string) => {
  const r = Validate.validate(
    await Bun.file(new URL(`../../dsl/starter/${name}.json`, import.meta.url)).json(),
  );

  if (!r.ok) throw new Error(name);

  return r.plugin;
};

test("activate, toggle, history, rollback, undo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "br-ws-"));
  const pop = await starter("pop");

  await Workspace.init(dir);
  await Workspace.activate(dir, pop, "host");
  await Workspace.activate(dir, { ...pop, version: 2, description: "v2" }, "host");

  const h = Workspace.history(dir, "pop");

  expect(Workspace.diff(dir, "pop", h[0]!.commit)).toContain('+  "version": 2');
  expect(() => Workspace.diff(dir, "pop", "--output=/tmp/x")).toThrow();

  expect(h.map((c) => c.message)).toEqual([
    "activate pop v2 (by host)",
    "activate pop v1 (by host)",
  ]);

  expect(() => Workspace.rollback(dir, "*", h[1]!.commit, "host")).toThrow();
  expect(() => Workspace.rollback(dir, "../enabled", h[1]!.commit, "host")).toThrow();

  await Workspace.setEnabled(dir, "pop", false, "host");
  expect((await Workspace.load(dir)).loaded.map((l) => [l.plugin.name, l.enabled])).toEqual([
    ["pop", false],
  ]);

  Workspace.rollback(dir, "pop", h[1]!.commit, "host");
  expect((await Workspace.load(dir)).loaded[0]?.plugin.version).toBe(1);

  Workspace.undoLast(dir, "host");
  expect((await Workspace.load(dir)).loaded[0]?.plugin.version).toBe(2);
});

test("invalid plugin files are reported, not loaded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "br-ws-"));

  await Workspace.init(dir);
  await Bun.write(join(dir, "plugins", "broken.json"), '{"name":"broken"}');

  const r = await Workspace.load(dir);

  expect([r.loaded.length, r.invalid[0]?.file]).toEqual([0, "broken.json"]);
});

test("tunnel url parsing", () => {
  expect(
    parseUrl("2026-10-10T11:00:00Z INF |  https://calm-river-banana-sunset.trycloudflare.com  |"),
  ).toBe("https://calm-river-banana-sunset.trycloudflare.com");
  expect(parseUrl("INF Starting tunnel")).toBeUndefined();
});

test("first run seeds starters; device plugins start disabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "br-ws-"));

  await Workspace.init(dir, [await starter("pop"), await starter("night-lights")]);

  const r = await Workspace.load(dir);

  expect(r.loaded.map((l) => [l.plugin.name, l.enabled])).toEqual([
    ["night-lights", false],
    ["pop", true],
  ]);
  expect(Workspace.history(dir, "pop")[0]?.message).toBe("starter plugins");
});

test("files dropped into plugins/ without activate() stay disabled; hooks never run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "br-ws-"));
  const pop = await starter("pop");

  await Workspace.init(dir);
  await Bun.write(join(dir, "plugins", "pop.json"), JSON.stringify(pop));
  await Bun.write(join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\ntouch pwned\n");
  chmodSync(join(dir, ".git", "hooks", "pre-commit"), 0o755);

  expect((await Workspace.load(dir)).loaded.map((l) => l.enabled)).toEqual([false]);

  await Workspace.activate(dir, pop, "host");

  expect((await Workspace.load(dir)).loaded.map((l) => l.enabled)).toEqual([true]);
  expect(await Bun.file(join(dir, "pwned")).exists()).toBe(false);
});
