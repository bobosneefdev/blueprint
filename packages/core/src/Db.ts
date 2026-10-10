// SQLite store (bun:sqlite + Drizzle). One file under %LOCALAPPDATA%\better-rust.
// Plugin definitions live in the git workspace, not here; this holds runtime data only.
import { Database } from "bun:sqlite";
import { and, eq, gte, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { blob, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const servers = sqliteTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  port: integer("port").notNull(),
  playerId: text("player_id").notNull(),
  playerToken: integer("player_token").notNull(),
  wipeTime: integer("wipe_time").notNull().default(0),
});

export const pluginState = sqliteTable(
  "plugin_state",
  {
    serverId: text("server_id").notNull(),
    plugin: text("plugin").notNull(),
    json: text("json").notNull(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.plugin] })],
);

/** Poll snapshots and pushed events, gzip'd JSON. Rolling 7 days; pruned on wipe. */
export const recordings = sqliteTable("recordings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serverId: text("server_id").notNull(),
  at: integer("at").notNull(),
  kind: text("kind", { enum: ["world", "event", "chat"] }).notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

const ddl = `
CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, ip TEXT NOT NULL,
  port INTEGER NOT NULL, player_id TEXT NOT NULL, player_token INTEGER NOT NULL,
  wipe_time INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS plugin_state (server_id TEXT NOT NULL, plugin TEXT NOT NULL,
  json TEXT NOT NULL, PRIMARY KEY (server_id, plugin));
CREATE TABLE IF NOT EXISTS recordings (id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, data BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS recordings_server_at ON recordings (server_id, at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// ponytail: DDL by hand instead of drizzle-kit migrations; four tables, no migration history yet.
// Switch to drizzle-kit generate + migrate() before the first schema change after release.
export const open = (path: string) => {
  const sqlite = new Database(path, { create: true });

  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec(ddl);

  return drizzle({ client: sqlite });
};

export type Db = ReturnType<typeof open>;

const RETENTION_SECONDS = 7 * 24 * 3600;

export const record = (
  db: Db,
  serverId: string,
  at: number,
  kind: "world" | "event" | "chat",
  json: string,
) =>
  db
    .insert(recordings)
    .values({ serverId, at, kind, data: Buffer.from(Bun.gzipSync(json)) })
    .run();

export const recorded = (db: Db, serverId: string, from: number) =>
  db
    .select()
    .from(recordings)
    .where(and(eq(recordings.serverId, serverId), gte(recordings.at, from)))
    .orderBy(recordings.at, recordings.id)
    .all()
    .map((r) => ({
      at: r.at,
      kind: r.kind,
      json: new TextDecoder().decode(Bun.gunzipSync(Uint8Array.from(r.data))),
    }));

export const prune = (db: Db, serverId: string, now: number) =>
  db
    .delete(recordings)
    .where(and(eq(recordings.serverId, serverId), lt(recordings.at, now - RETENTION_SECONDS)))
    .run();

export const wipeRecordings = (db: Db, serverId: string) =>
  db.delete(recordings).where(eq(recordings.serverId, serverId)).run();
