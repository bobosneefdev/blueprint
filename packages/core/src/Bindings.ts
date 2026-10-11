// Per-server device bindings: plugin binding name -> paired smart device.
// Stored in the workspace at servers/<id>/bindings.json so they are versioned with plugins and
// reset on wipe (entity ids change every wipe).
import type { Plugin } from "@blueprint/dsl";
import { Schema } from "effect";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const Device = Schema.Struct({
  entityId: Schema.Number,
  kind: Schema.Literals(["switch", "alarm", "storageMonitor"]),
  /** In-game label the player gave the device ("Smart Alarm" by default). */
  label: Schema.String,
});

export interface Device extends Schema.Schema.Type<typeof Device> {}

/** Rust+ AppEntityType. */
const kinds = new Map<number, Device["kind"]>([
  [1, "switch"],
  [2, "alarm"],
  [3, "storageMonitor"],
]);

export const kindOf = (entityType: number) => kinds.get(entityType);

export const File = Schema.Struct({
  /** Every device paired on this server since the last wipe. */
  devices: Schema.Array(Device),
  /** binding name -> entityId */
  bindings: Schema.Record(Schema.String, Schema.Number),
});

export interface File extends Schema.Schema.Type<typeof File> {}

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(File));

const path = (workspace: string, serverId: string) =>
  join(workspace, "servers", serverId, "bindings.json");

export const read = async (workspace: string, serverId: string): Promise<File> => {
  const f = Bun.file(path(workspace, serverId));

  return (await f.exists()) ? decode(await f.text()) : { devices: [], bindings: {} };
};

export const write = async (workspace: string, serverId: string, file: File) => {
  mkdirSync(join(workspace, "servers", serverId), { recursive: true });
  await Bun.write(path(workspace, serverId), `${JSON.stringify(file, null, 2)}\n`);
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Adds a newly paired device and binds it to every unbound plugin binding of the same kind whose
 * name matches the device label (e.g. device "Base Alarm" -> binding "base-alarm"). If exactly
 * one unbound binding of that kind exists, it binds that one regardless of label.
 */
export const addDevice = (file: File, device: Device, plugins: ReadonlyArray<Plugin>): File => {
  const devices = [...file.devices.filter((d) => d.entityId !== device.entityId), device];
  const bindings = { ...file.bindings };

  const unbound = plugins
    .flatMap((p) => p.bindings)
    .filter((b) => b.kind === device.kind && bindings[b.name] === undefined);

  const byLabel = unbound.filter((b) => norm(b.name) === norm(device.label));

  const targets = byLabel.length > 0 ? byLabel : unbound.length === 1 ? unbound : [];

  for (const b of targets) bindings[b.name] = device.entityId;

  return { devices, bindings };
};

/** Bindings a plugin declares that have no device on this server. Unbound plugins are paused. */
export const missing = (file: File, plugin: Plugin) =>
  plugin.bindings.flatMap((b) =>
    b.kind !== "location" && file.bindings[b.name] === undefined ? [b.name] : [],
  );

export const forServer = (file: File) =>
  Object.entries(file.bindings).flatMap(([name, entityId]) => {
    const d = file.devices.find((x) => x.entityId === entityId);

    return d === undefined ? [] : [{ name, entityId, kind: d.kind }];
  });
