// WSL agent sandbox lifecycle (Windows only). The distro has automount and interop off. Before
// each agent run, as root:
//   <home>\agent-share  -> /workspace  (drvfs mount of that ONE directory, rw)
//   <home>\rust-items-json\data -> copied into /data/rust-items-json/data (not mounted)
//
// Verified on a real WSL2 distro: a drvfs mount of a single Windows directory does not expose its
// parent, but drvfs ignores `ro` for the agent, so game data is copied in instead of mounted.
// agent-share holds only plugin files (no .git): the bot's git repo, config.json and the db are
// never visible to the agent. See Workspace.ts for how files move between the two.
import { join } from "node:path";

export const DISTRO = "better-rust-agent";

const wsl = (...args: string[]) => {
  const r = Bun.spawnSync(["wsl.exe", ...args], { stdout: "pipe", stderr: "pipe" });

  // wsl.exe writes UTF-16LE for its own messages.
  const text = (b: Buffer) => b.toString(b.includes(0) ? "utf16le" : "utf8").trim();

  return { ok: r.exitCode === 0, out: text(r.stdout), err: text(r.stderr) };
};

export const installed = () => wsl("--list", "--quiet").out.split(/\r?\n/).includes(DISTRO);

/** First run: import the rootfs tarball the installer downloaded. */
export const ensure = (home: string) => {
  if (installed()) return;

  const r = wsl(
    "--import",
    DISTRO,
    join(home, "wsl"),
    join(home, "better-rust-agent.tar.gz"),
    "--version",
    "2",
  );

  if (!r.ok) throw new Error(`wsl --import failed: ${r.err || r.out}`);
};

/**
 * The bot RPC must be reachable from the distro but not from the LAN. WSL2 NAT puts Windows on a
 * vEthernet "WSL" adapter (the distro's default gateway); bind the RPC server to that address
 * only. Returns undefined when WSL is not up yet (caller falls back to loopback).
 */
export const hostAddress = () => {
  const r = Bun.spawnSync(
    [
      "powershell.exe",
      "-NoProfile",
      "-Command",
      "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object InterfaceAlias -like '*WSL*' | Select-Object -First 1).IPAddress",
    ],
    { stdout: "pipe", stderr: "ignore" },
  );

  const ip = r.stdout.toString().trim();

  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : undefined;
};

/** Single-quoted for sh; Windows paths can contain spaces (user names). */
const q = (s: string) => `'${s.replaceAll("'", `'"'"'`)}'`;

/** Idempotent setup script, run as root inside the distro before each agent job. */
export const mountScript = (share: string, gameData: string) =>
  [
    "set -e",
    // Leftover processes from a previous requester's job must not see this job's token.
    "pkill -KILL -u agent 2>/dev/null || true",
    `mountpoint -q /workspace || mount -t drvfs ${q(share)} /workspace -o metadata,uid=1000,gid=1000`,
    "rm -rf /data/rust-items-json/data.tmp && mkdir -p /data/rust-items-json/data.tmp",
    `mount -t drvfs ${q(gameData)} /mnt/gamedata -o ro 2>/dev/null || { mkdir -p /mnt/gamedata && mount -t drvfs ${q(gameData)} /mnt/gamedata -o ro; }`,
    "cp -r /mnt/gamedata/. /data/rust-items-json/data.tmp/ && umount /mnt/gamedata",
    "rm -rf /data/rust-items-json/data && mv /data/rust-items-json/data.tmp /data/rust-items-json/data",
    "chown -R root:root /data/rust-items-json && chmod -R a+rX,go-w /data/rust-items-json",
  ].join("\n");

export const prepare = (home: string, share: string) => {
  ensure(home);

  const r = wsl(
    "-d",
    DISTRO,
    "-u",
    "root",
    "--",
    "sh",
    "-c",
    mountScript(share, join(home, "rust-items-json", "data")),
  );

  if (!r.ok) throw new Error(`sandbox setup failed: ${r.err || r.out}`);
};
