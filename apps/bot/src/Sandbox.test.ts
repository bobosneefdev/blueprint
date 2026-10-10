import { expect, test } from "bun:test";
import { mountScript, toDistroPath } from "./Sandbox.ts";

test("windows paths map under the private mount root", () => {
  expect(toDistroPath("C:\\Users\\Jake\\AppData\\Local\\better-rust")).toBe(
    "/mnt/host/c/Users/Jake/AppData/Local/better-rust",
  );
  expect(() => toDistroPath("relative\\path")).toThrow();
});

test("mount script binds only workspace (rw) and game data (ro), then hides the drive", () => {
  const s = mountScript("D:\\br");

  expect(s).toContain("mount -t drvfs D: /mnt/host/d");
  expect(s).toContain("mount --bind '/mnt/host/d/br/workspace' /workspace");
  expect(s).toContain("mount --bind -o ro '/mnt/host/d/br/rust-items-json' /data/rust-items-json");
  expect(s.trim().endsWith("chmod 700 /mnt/host")).toBe(true);
});
