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
import egressAllow from "../../../packages/installer/rootfs/egress-allow.txt" with { type: "text" };

export const DISTRO = "blueprint-agent";

const wsl = (...args: string[]) => {
  const r = Bun.spawnSync(["wsl.exe", ...args], { stdout: "pipe", stderr: "pipe" });

  // wsl.exe writes UTF-16LE for its own messages.
  const text = (b: Buffer) => b.toString(b.includes(0) ? "utf16le" : "utf8").trim();

  return { ok: r.exitCode === 0, out: text(r.stdout), err: text(r.stderr) };
};

export const installed = () => wsl("--list", "--quiet").out.split(/\r?\n/).includes(DISTRO);

let importing: Promise<void> | undefined;

/**
 * First run: import the rootfs tarball the installer downloaded. Async (an import takes a minute
 * and must not stall Rust+ or the portal) and shared, so concurrent callers import once.
 */
export const ensure = (home: string) => {
  if (installed()) return Promise.resolve();

  importing ??= (async () => {
    const p = Bun.spawn(
      [
        "wsl.exe",
        "--import",
        DISTRO,
        join(home, "wsl"),
        join(home, "blueprint-agent.tar.gz"),
        "--version",
        "2",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const [out, err, code] = await Promise.all([
      new Response(p.stdout).arrayBuffer(),
      new Response(p.stderr).arrayBuffer(),
      p.exited,
    ]);

    // wsl.exe writes UTF-16LE for its own messages.
    const text = (b: ArrayBuffer) => Buffer.from(b).toString("utf16le").replaceAll("\0", "").trim();

    if (code !== 0) throw new Error(`wsl --import failed: ${text(err) || text(out)}`);
  })().finally(() => {
    importing = undefined;
  });

  return importing;
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

/**
 * Brings WSL up (its vEthernet adapter only exists while a distro runs) and returns the host-side
 * address, or undefined if the sandbox isn't installed yet. Bounded: ~10s worst case.
 */
export const bootAndAddress = () => {
  if (!installed()) return undefined;

  wsl("-d", DISTRO, "-u", "root", "--", "true");

  for (let i = 0; i < 10; i++) {
    const ip = hostAddress();

    if (ip !== undefined) return ip;

    Bun.sleepSync(1000);
  }

  return undefined;
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

export const prepare = async (home: string, share: string) => {
  await ensure(home);

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

/**
 * Brings an already-imported sandbox up to this release's system files. The rootfs is only
 * imported once, so later releases' egress hosts and packages would otherwise never arrive.
 * Root-only, idempotent; the firewall is rebuilt only when the allowlist changed.
 */
export const syncSystem = () => {
  const r = Bun.spawnSync(
    [
      "wsl.exe",
      "-d",
      DISTRO,
      "-u",
      "root",
      "--",
      "sh",
      "-c",
      [
        "set -e",
        "cat > /tmp/egress-allow.txt",
        "command -v script >/dev/null || apk add --no-cache -q util-linux-misc",
        "cmp -s /tmp/egress-allow.txt /etc/egress-allow.txt && exit 0",
        "mv /tmp/egress-allow.txt /etc/egress-allow.txt",
        "/usr/local/sbin/egress-firewall",
      ].join("\n"),
    ],
    { stdin: new TextEncoder().encode(egressAllow), stdout: "pipe", stderr: "pipe" },
  );

  if (r.exitCode !== 0) throw new Error(`sandbox update failed: ${r.stderr.toString().trim()}`);
};
