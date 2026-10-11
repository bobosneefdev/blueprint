import { expect, test } from "bun:test";
import { toastScript } from "./Notify.ts";

test("toast text is escaped for both XML and the PowerShell single-quoted string", () => {
  const s = toastScript("blueprint", "Base <alarm> & it's loud");

  expect(s).toContain("Base &lt;alarm> &amp; it''s loud");
  expect(s).not.toContain("it's");
});
