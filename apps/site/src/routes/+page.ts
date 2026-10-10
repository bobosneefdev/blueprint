import { Validate } from "@better-rust/dsl";

// The gallery index is built from the starter plugins at build time (static site, no backend).
// JSON imports are plain JSON; validate() is the decode boundary.
const files = import.meta.glob<Parameters<typeof Validate.validate>[0]>(
  "../../../../packages/dsl/starter/*.json",
  {
    eager: true,
    import: "default",
  },
);

export const load = () => ({
  plugins: Object.values(files).flatMap((json) => {
    const r = Validate.validate(json);

    return r.ok
      ? [
          {
            name: r.plugin.name,
            description: r.plugin.description,
            trigger: r.plugin.trigger._tag,
            heuristic: r.plugin.heuristic,
          },
        ]
      : [];
  }),
});
