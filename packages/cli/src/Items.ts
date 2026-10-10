// Compact lookups over rust-items-json. The full dataset is ~15MB of JSON; agents get small,
// relevant slices here and can `rg`/`jq` the read-only data dir for anything deeper.
import { Schema } from "effect";

const Item = Schema.Struct({
  id: Schema.Number,
  shortname: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  category: Schema.String,
  stackable: Schema.optionalKey(Schema.Number),
  crafting: Schema.optionalKey(
    Schema.Struct({
      ingredients: Schema.Array(Schema.Struct({ item: Schema.String, amount: Schema.Number })),
      workbench: Schema.optionalKey(Schema.Number),
      time: Schema.optionalKey(Schema.Number),
    }),
  ),
  recycle: Schema.optionalKey(
    Schema.Array(Schema.Struct({ item: Schema.String, amount: Schema.Number })),
  ),
});

export interface Item extends Schema.Schema.Type<typeof Item> {}

const Raid = Schema.Struct({
  prefab: Schema.optionalKey(Schema.String),
  item: Schema.optionalKey(Schema.String),
  grade: Schema.optionalKey(Schema.String),
  health: Schema.Number,
  explosives: Schema.Record(
    Schema.String,
    Schema.Struct({
      hard: Schema.optionalKey(Schema.Number),
      soft: Schema.optionalKey(Schema.Number),
    }),
  ),
});

export interface Raid extends Schema.Schema.Type<typeof Raid> {}

const decodeItems = Schema.decodeUnknownSync(Schema.Array(Item));

const decodeRaid = Schema.decodeUnknownSync(Schema.Array(Raid));

export const loadItems = async (dir: string) =>
  decodeItems(await Bun.file(`${dir}/items.json`).json());

export const loadRaid = async (dir: string) =>
  decodeRaid(await Bun.file(`${dir}/raid.json`).json());

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Ranked fuzzy match on name/shortname: exact > prefix > substring. */
export const search = (items: ReadonlyArray<Item>, query: string, limit = 10): Item[] => {
  const q = norm(query);

  const score = (i: Item) => {
    const n = norm(i.name);
    const s = norm(i.shortname);

    if (n === q || s === q) return 0;

    if (n.startsWith(q) || s.startsWith(q)) return 1;

    if (n.includes(q) || s.includes(q)) return 2;

    return 3;
  };

  return items
    .flatMap((i) => (score(i) < 3 ? [[score(i), i] as const] : []))
    .sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length)
    .slice(0, limit)
    .map(([, i]) => i);
};

/** Short name of a raid target: "stone wall", "sheet metal door". */
const targetName = (r: Raid, items: ReadonlyArray<Item>) =>
  r.item !== undefined
    ? (items.find((i) => i.shortname === r.item)?.name ?? r.item)
    : `${r.grade ?? ""} ${(r.prefab ?? "").split("/").at(-1)?.replace(".prefab", "").replaceAll(".", " ")}`.trim();

export const raidCosts = (raid: ReadonlyArray<Raid>, items: ReadonlyArray<Item>, query: string) => {
  const q = norm(query);

  return raid
    .flatMap((r) => {
      const target = targetName(r, items);

      return norm(target).includes(q) ? [{ target, r }] : [];
    })
    .sort((a, b) => a.target.length - b.target.length)
    .slice(0, 5)
    .map(({ target, r }) => ({
      target,
      health: r.health,
      explosives: Object.fromEntries(
        Object.entries(r.explosives)
          .flatMap(([k, v]) => (v.hard !== undefined && v.hard < 100 ? [[k, v.hard] as const] : []))
          .sort((a, b) => a[1] - b[1])
          .map(([k, hard]) => [items.find((i) => i.shortname === k)?.name ?? k, hard]),
      ),
    }));
};
