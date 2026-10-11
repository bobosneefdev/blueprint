// Plugin Notify action: Windows toast on the host PC and/or a push to the host's phone (ntfy.sh
// and/or a Discord webhook). Both are secrets chosen in settings; nothing else leaves the PC.

/** Windows toast via PowerShell's WinRT bridge; no extra dependency or registered app needed. */
const toastScript = (title: string, text: string) => {
  const esc = (s: string) =>
    s.replaceAll("'", "''").replaceAll("&", "&amp;").replaceAll("<", "&lt;");

  return [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null",
    "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${esc(title)}</text><text>${esc(text)}</text></binding></visual></toast>')`,
    // PowerShell's own AppUserModelID always exists, so the toast shows without registration.
    "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))",
  ].join("; ");
};

export const toast = (title: string, text: string) => {
  if (process.platform !== "win32") return console.log(`[toast] ${title}: ${text}`);

  Bun.spawn(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", toastScript(title, text)],
    {
      stdout: "ignore",
      stderr: "ignore",
    },
  );
};

export const phone = async (topic: string, title: string, text: string) => {
  await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: { Title: title, Priority: "high" },
    body: text,
  });
};

/** Only Discord's own webhook endpoints: the URL is user input, so no SSRF to the LAN. */
export const isDiscordWebhook = (url: string) =>
  /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url);

export const discord = async (webhook: string, text: string) => {
  if (!isDiscordWebhook(webhook)) return;

  await fetch(webhook, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    // Plugin text can quote team chat; never let it ping @everyone or roles.
    body: JSON.stringify({
      username: "blueprint",
      content: text.slice(0, 2000),
      allowed_mentions: { parse: [] },
    }),
  });
};

export const send = async (
  to: { readonly ntfyTopic?: string | undefined; readonly discordWebhook?: string | undefined },
  text: string,
  channel: "toast" | "phone" | "both",
) => {
  if (channel !== "phone") toast("blueprint", text);

  if (channel === "toast") return;

  await Promise.allSettled([
    to.ntfyTopic === undefined ? undefined : phone(to.ntfyTopic, "blueprint", text),
    to.discordWebhook === undefined ? undefined : discord(to.discordWebhook, text),
  ]);
};

export { toastScript };
