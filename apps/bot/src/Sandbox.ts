// WSL agent sandbox lifecycle (Windows only). The distro has automount and interop off, so the
// bot bind-mounts exactly two host paths in as root before any agent run:
//   <home>\workspace           -> /workspace (rw)
//   <home>\rust-items-json     -> /data/rust-items-json (ro)
// Windows drives are reachable as 9p shares even with automount off; mounting them is root-only
// and the agent user has no sudo.
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

/** `C:\Users\x\AppData` -> `/mnt/host/c/Users/x/AppData` inside the distro (our own mount root). */
export const toDistroPath = (windowsPath: string) => {
  const m = /^([A-Za-z]):\\(.*)$/.exec(windowsPath);

  if (!m?.[1]) throw new Error(`not an absolute Windows path: ${windowsPath}`);

  return `/mnt/host/${m[1].toLowerCase()}/${(m[2] ?? "").replaceAll("\\", "/")}`;
};

/** Idempotent: mounts the drive share privately, then binds only the two paths the agent needs. */
export const mountScript = (home: string) => {
  const drive = home.slice(0, 1).toLowerCase();
  const src = toDistroPath(home);

  return [
    "set -e",
    `mkdir -p /mnt/host/${drive}`,
    `mountpoint -q /mnt/host/${drive} || mount -t drvfs ${drive.toUpperCase()}: /mnt/host/${drive} -o metadata,uid=1000,gid=1000`,
    `mountpoint -q /workspace || mount --bind '${src}/workspace' /workspace`,
    `mountpoint -q /data/rust-items-json || mount --bind -o ro '${src}/rust-items-json' /data/rust-items-json`,
    // Hide the drive share from the agent: only root can traverse /mnt/host.
    "chmod 700 /mnt/host",
  ].join("\n");
};

export const prepare = (home: string) => {
  ensure(home);

  const r = wsl("-d", DISTRO, "-u", "root", "--", "sh", "-c", mountScript(home));

  if (!r.ok) throw new Error(`sandbox mount failed: ${r.err || r.out}`);
};
