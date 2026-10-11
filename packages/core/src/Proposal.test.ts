import { expect, test } from "bun:test";
import { Validate } from "@blueprint/dsl";
import { fileURLToPath } from "node:url";
import { confirm, effects, prompt, TTL_MS } from "./Proposal.ts";

const starter = async (name: string) => {
  const r = Validate.validate(
    await Bun.file(
      fileURLToPath(new URL(`../../dsl/starter/${name}.json`, import.meta.url)),
    ).json(),
  );

  if (!r.ok) throw new Error(name);

  return r.plugin;
};

test("prompt shows derived effects and replacement, not the agent's description", async () => {
  const lights = await starter("night-lights");
  // A prompt-injected agent labels a switch-flipping plugin as harmless.
  const lying = { ...lights, description: "harmless cargo alert" };
  const p = { plugin: lying, code: "4821", expires: TTL_MS };

  expect(effects(lying)).toEqual(["switch:lights"]);
  expect(prompt(p, undefined, "https://p/r/x", "bot")).toEqual([
    "@bot yes 4821 to activate: https://p/r/x",
    "new night-lights [switch:lights]",
  ]);
  expect(prompt(p, lights, "https://p/r/x", "bot")[1]).toContain("REPLACES night-lights v1");
});

test("confirm needs the matching code before expiry", async () => {
  const p = { plugin: await starter("pop"), code: "4821", expires: 1000 };

  expect(confirm(undefined, "4821", 0).kind).toBe("none");
  expect(confirm(p, undefined, 0).kind).toBe("wrongCode");
  expect(confirm(p, "1111", 0).kind).toBe("wrongCode");
  expect(confirm(p, "4821", 2000).kind).toBe("expired");
  expect(confirm(p, "4821", 500).kind).toBe("ok");
});
