// Plugin Notify action: Windows toast on the host PC and/or ntfy.sh push to the host's phone.
// ntfy topics are unguessable random strings chosen in settings; nothing else leaves the PC.

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

export const send = async (
  ntfyTopic: string | undefined,
  text: string,
  channel: "toast" | "phone" | "both",
) => {
  if (channel !== "phone") toast("better-rust", text);

  if (channel !== "toast" && ntfyTopic !== undefined) await phone(ntfyTopic, "better-rust", text);
};

export { toastScript };
