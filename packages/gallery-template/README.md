# better-rust-plugins

Community plugins for [better-rust](https://github.com/bobosneefdev/better-rust).

## Submit a plugin

1. Ask your bot to build it, then copy `plugins/<name>.json` from your workspace
   (`%LOCALAPPDATA%\better-rust\workspace\plugins`).
2. Open a PR adding it to `plugins/`. CI runs `bot validate` on it: the schema, CEL type checks,
   real event payloads, and the plugin's own fixture tests must all pass.
3. Plugins that approximate data Rust+ doesn't expose must say so in `heuristic`.

Import in your portal: Settings → Import from gallery → paste the file's raw GitHub URL.

## Creating the repo

This folder is the template for the `better-rust-plugins` repo. Seed it with the starter pack
from `packages/dsl/starter/` when creating it; after that, the gallery repo is the source of
community plugins and this template only changes for CI.
