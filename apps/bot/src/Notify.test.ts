import { expect, test } from "bun:test";
import { isDiscordWebhook, toastScript } from "./Notify.ts";

test("toast text is escaped for both XML and the PowerShell single-quoted string", () => {
  const s = toastScript("blueprint", "Base <alarm> & it's loud");

  expect(s).toContain("Base &lt;alarm> &amp; it''s loud");
  expect(s).not.toContain("it's");
});

test("only Discord webhook URLs are accepted", () => {
  expect(
    [
      "https://discord.com/api/webhooks/123/abc-DEF_9",
      "https://discordapp.com/api/webhooks/1/x",
      "http://discord.com/api/webhooks/1/x",
      "https://discord.com.evil.io/api/webhooks/1/x",
      "https://192.168.1.1/api/webhooks/1/x",
    ].map(isDiscordWebhook),
  ).toEqual([true, true, false, false, false]);
});
