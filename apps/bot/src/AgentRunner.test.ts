import { expect, test } from "bun:test";
import { shQuote } from "./AgentRunner.ts";

test("shQuote survives hostile chat text through sh -c", () => {
  const nasty = `it's $(rm -rf ~) \`id\` "x" ; echo pwned`;
  const r = Bun.spawnSync(["sh", "-c", `printf %s ${shQuote(nasty)}`], { stdout: "pipe" });

  expect(r.stdout.toString()).toBe(nasty);
});
