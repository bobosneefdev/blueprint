import { expect, test } from "bun:test";
import { mountScript } from "./Sandbox.ts";

test("mounts only the share dir; copies game data; never mounts a whole drive", () => {
  const s = mountScript(
    "C:\\Users\\Jo O'Neil\\AppData\\Local\\blueprint\\agent-share",
    "C:\\Users\\Jo O'Neil\\AppData\\Local\\blueprint\\rust-items-json\\data",
  );

  expect(s).toContain(
    `mount -t drvfs 'C:\\Users\\Jo O'"'"'Neil\\AppData\\Local\\blueprint\\agent-share' /workspace`,
  );
  expect(s).toContain("cp -r /mnt/gamedata/. /data/rust-items-json/data.tmp/");
  expect(s).toContain("pkill -KILL -u agent");
  expect(s).not.toMatch(/drvfs [A-Z]: /);
});
