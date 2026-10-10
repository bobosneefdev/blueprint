<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const install = `powershell -ExecutionPolicy ByPass -c "irm https://github.com/bobosneefdev/better-rust/releases/latest/download/install.ps1 | iex"`;

  let copied = $state(false);

  const copy = async () => {
    await navigator.clipboard.writeText(install);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  };

  const chat = [
    { who: "you", text: "@bot ping us when cargo spawns, with the grid" },
    { who: "bot", text: "on it…" },
    { who: "bot", text: "cargo-alert: Cargo Ship spawned → chat with grid. Reply @bot yes to activate" },
    { who: "you", text: "@bot yes" },
    { who: "bot", text: "cargo-alert is live" },
    { who: "bot", text: "Cargo Ship spawned at G3" },
  ];

  const features = [
    { title: "Ask for features in chat", body: "Type what you want in team chat. The AI writes a small plugin, tests it on your server's recent data, and asks you to confirm." },
    { title: "Honest about limits", body: "Rust+ can't see inventories, enemies or AFK. When you ask for those, it says so and offers the closest thing it can actually do." },
    { title: "Game data built in", body: "Raid costs, crafting, recycling and loot from the weekly-updated rust-items-json. Ask \"@bot rockets for a stone wall?\"" },
    { title: "Smart switches & alarms", body: "Lights at night, alarm relays to chat and phone, turrets off when a teammate logs in. Your paired devices, your rules." },
    { title: "Runs on your PC", body: "Self-hosted. Bring Claude Code, Codex or Pi. The AI runs in a locked-down sandbox that can't see your files." },
    { title: "Undo anything", body: "Every plugin change is versioned. @bot undo in chat, or restore any version from the web portal." },
  ];

  const faq = [
    { q: "Is this a cheat? Will it get me banned?", a: "No. It only uses Rust+, Facepunch's official companion API, the same one the Rust+ phone app uses. It never touches the game client, reads memory, or interacts with Easy Anti-Cheat. Everything it knows comes from what Rust+ shows your team." },
    { q: "Why does Windows warn about the installer?", a: "It isn't code-signed yet. Every release is built in public by GitHub Actions from the tagged source, with SHA256 checksums, build provenance you can verify with `gh attestation verify`, and a VirusTotal report linked in the release notes." },
    { q: "What does it need from me?", a: "Windows 10/11, WSL (the installer sets it up), a Steam account to sign in to Rust+ on Facepunch's own page, and one of Claude Code, Codex or Pi for the AI." },
    { q: "Who can use the AI?", a: "Only you and teammates you allowlist (by Steam account). Anyone on the team can run the slash commands plugins create." },
    { q: "Does it send my data anywhere?", a: "No telemetry. The only outbound traffic is Rust+ itself, your chosen AI provider, game-data updates from GitHub, and the update check." },
  ];
</script>

<svelte:head>
  <title>better-rust: type a feature into Rust team chat</title>
  <meta
    name="description"
    content="A self-hosted Rust+ team bot you program by asking. Type what you want in team chat; an AI builds, tests and runs it."
  />
</svelte:head>

<main class="mx-auto flex max-w-6xl flex-col gap-24 px-4 py-12 md:px-8 md:py-20">
  <section class="grid items-center gap-10 lg:grid-cols-2">
    <div class="flex min-w-0 flex-col gap-6">
      <span class="badge badge-outline">Open source · Rust+ · Windows</span>
      <h1 class="text-4xl leading-tight font-bold text-balance md:text-5xl">
        Type a feature into team chat. <span class="text-primary">It just exists.</span>
      </h1>
      <p class="text-base-content/75 max-w-prose text-lg">
        better-rust is a Rust+ team bot you program by asking. An AI writes the plugin, tests it
        against your server, and runs it once you confirm.
      </p>
      <div class="flex flex-col gap-2">
        <div class="join w-full min-w-0">
          <code class="join-item bg-base-200 border-base-300 min-w-0 flex-1 overflow-x-auto border px-3 py-3 text-sm whitespace-nowrap">{install}</code>
          <button class="btn btn-primary join-item h-auto" onclick={copy} aria-label="Copy install command">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p class="text-base-content/60 text-sm">
          Paste into PowerShell. <a class="link" href="https://github.com/bobosneefdev/better-rust/blob/main/packages/installer/install.ps1">Read the script first</a>, it's short.
        </p>
      </div>
    </div>

    <div class="mockup-window bg-base-200 border-base-300 min-w-0 border">
      <div class="flex flex-col gap-1 p-4 font-mono text-sm break-words" aria-label="Example team chat">
        {#each chat as line, i (i)}
          <p>
            <span class={line.who === "bot" ? "text-primary" : "text-secondary"}>{line.who === "bot" ? "[bot]" : "You"}:</span>
            {line.text}
          </p>
        {/each}
      </div>
    </div>
  </section>

  <section class="flex flex-col gap-8">
    <h2 class="text-3xl font-bold">What it does</h2>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each features as f (f.title)}
        <div class="card bg-base-200">
          <div class="card-body">
            <h3 class="card-title text-lg">{f.title}</h3>
            <p class="text-base-content/75">{f.body}</p>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="flex flex-col gap-8" id="plugins">
    <div class="flex flex-col gap-2">
      <h2 class="text-3xl font-bold">Starter plugins</h2>
      <p class="text-base-content/70">Included out of the box. Everything else, just ask.</p>
    </div>
    <ul class="list bg-base-200 rounded-box">
      {#each data.plugins as p (p.name)}
        <li class="list-row items-center">
          <span class="font-mono font-semibold break-all">{p.name}</span>
          <span class="text-base-content/75">{p.description}</span>
          <span class="badge badge-sm">{p.trigger}</span>
        </li>
      {/each}
    </ul>
  </section>

  <section class="flex flex-col gap-6" id="faq">
    <h2 class="text-3xl font-bold">FAQ</h2>
    <div class="flex flex-col gap-2">
      {#each faq as item (item.q)}
        <details class="collapse collapse-arrow bg-base-200">
          <summary class="collapse-title font-semibold">{item.q}</summary>
          <div class="collapse-content text-base-content/80">{item.a}</div>
        </details>
      {/each}
    </div>
  </section>

  <footer class="text-base-content/60 flex flex-col gap-2 text-sm md:flex-row md:justify-between">
    <span>AGPL-3.0 · Not affiliated with Facepunch Studios.</span>
    <a class="link" href="https://github.com/bobosneefdev/better-rust">GitHub</a>
  </footer>
</main>
