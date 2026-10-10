// Keeps <home>/rust-items-json/data current from bobosneefdev/rust-items-json releases.
// Each Rust update is a release tagged build-<id> with the data/ folder; meta.json says which
// build we have, so most syncs are one small request.
import { Schema } from "effect";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const RAW = "https://raw.githubusercontent.com/bobosneefdev/rust-items-json/master/data";

/** Files the agent tools use. Icons and the large monument/world files stay remote. */
export const FILES = [
  "meta.json",
  "items.json",
  "item-properties.json",
  "raid.json",
  "explosives.json",
  "building.json",
  "recyclers.json",
  "techtree.json",
  "vending.json",
  "loot-probabilities.json",
];

const Meta = Schema.Struct({ build: Schema.String });

const decodeMeta = Schema.decodeUnknownSync(Schema.fromJsonString(Meta));

const localBuild = async (path: string) => {
  const f = Bun.file(path);

  return (await f.exists()) ? decodeMeta(await f.text()).build : undefined;
};

export const sync = async (dir: string, fetchFn: typeof fetch = fetch) => {
  const data = join(dir, "data");

  mkdirSync(data, { recursive: true });

  const meta = await fetchFn(`${RAW}/meta.json`);

  if (!meta.ok) throw new Error(`meta.json ${meta.status}`);

  const metaText = await meta.text();

  if (decodeMeta(metaText).build === (await localBuild(join(data, "meta.json")))) return false;

  for (const file of FILES.filter((f) => f !== "meta.json")) {
    const r = await fetchFn(`${RAW}/${file}`);

    if (!r.ok) throw new Error(`${file} ${r.status}`);

    await Bun.write(join(data, file), r);
  }

  // meta last, so a partial sync is retried next time.
  await Bun.write(join(data, "meta.json"), metaText);

  return true;
};
