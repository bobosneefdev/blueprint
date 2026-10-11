<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const install = `powershell -ExecutionPolicy ByPass -c "irm https://blueprint.bobosneef.dev/install.ps1 | iex"`;

  let copied = $state(false);

  const copy = async () => {
    await navigator.clipboard.writeText(install);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  };

  // The bot speaks through the host's Rust+ account, so its lines carry the host's name.
  const chat = [
    { who: "rook", text: "@bot ping us when cargo spawns, with the grid" },
    { who: "bobo", text: "[bot] on it…" },
    { who: "bobo", text: "[bot] say @bot yes 4821 to activate cargo-alert" },
    { who: "rook", text: "@bot yes 4821" },
    { who: "bobo", text: "[bot] cargo-alert is live" },
    { who: "bobo", text: "[bot] Cargo Ship spawned at G3" },
  ];

  const pillars = [
    { title: "Just ask", body: "Describe it in team chat. The AI builds it, tests it, and waits for your yes." },
    { title: "Any server", body: "No server mods or admin. If Rust+ works there, Blueprint does." },
    { title: "Ban-safe", body: "Only Facepunch's official Rust+ API. Never touches the game or anti-cheat." },
  ];

  const faq = [
    { q: "Can it get me banned?", a: "No. It only talks to Rust+, Facepunch's official companion API, the same one the phone app uses. It never touches the game client, reads memory, or goes near Easy Anti-Cheat." },
    { q: "Is it free?", a: "Yes. Blueprint is open source under AGPL-3.0. The AI runs on your own Claude Code, Codex or Pi subscription, so there's nothing extra to pay us." },
    { q: "What do I need?", a: "A Windows 10 or 11 PC, a Steam account to sign in to Rust+, and one of Claude Code, Codex or Pi. The installer sets up WSL for you." },
    { q: "Does my PC need to stay on?", a: "Yes. Blueprint runs on your machine, so plugins only fire while it's running. Rust+ keeps working on your phone either way." },
    { q: "Who on my team can use it?", a: "You decide, per server. Interact lets a teammate ask the bot and run plugin commands. Admin also lets them add and switch plugins." },
    { q: "What can't it do?", a: "Rust+ can't see inventories, enemy players or who's AFK at a keyboard. Ask for one of those and it tells you, then offers the closest thing it can actually do." },
    { q: "Is my data safe?", a: "There's no telemetry. The AI works in a locked-down sandbox that can't see your files, and the only traffic is Rust+, your AI provider, game-data updates and the update check." },
    { q: "What if a plugin goes wrong?", a: "Every change is versioned. Say @bot undo in team chat, or restore any earlier version from the web portal." },
    { q: "Why does Windows warn about the installer?", a: "It isn't code-signed yet. Every release is built in public by GitHub Actions, with SHA256 checksums, verifiable build provenance and a VirusTotal report in the release notes." },
  ];
</script>

<svelte:head>
  <title>Blueprint: type a feature into Rust team chat</title>
  <meta
    name="description"
    content="A self-hosted Rust+ team bot you program by asking. Type what you want in team chat; an AI builds, tests and runs it."
  />
</svelte:head>

<main class="mx-auto flex max-w-6xl flex-col gap-24 px-4 py-12 md:px-8 md:py-20">
  <section class="grid items-center gap-10 lg:grid-cols-2">
    <div class="flex min-w-0 flex-col gap-6">
      <h1 class="text-4xl leading-tight font-semibold text-balance md:text-5xl">
        Type a feature into team chat. <span class="text-secondary">It just exists.</span>
      </h1>
      <p class="text-base-content/75 max-w-prose text-lg">A Rust+ team bot you program by asking.</p>
      <div class="flex flex-col gap-2">
        <div class="join w-full min-w-0">
          <code class="join-item bg-base-200 border-base-300 min-w-0 flex-1 overflow-x-auto border px-3 py-3 text-sm whitespace-nowrap">{install}</code>
          <button class="btn btn-primary join-item h-auto" onclick={copy} aria-label="Copy install command">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p class="text-base-content/60 text-sm">
          Free and open source. Paste into PowerShell, or <a class="link" href="https://github.com/bobosneefdev/blueprint/blob/main/packages/installer/install.ps1">read the script</a>.
        </p>
      </div>
    </div>

    <div class="rust-chat rounded-box flex min-w-0 flex-col gap-4 p-5" aria-label="Example team chat">
      {#each chat as line, i (i)}
        <p class="flex items-start gap-3">
          <img class="size-9 shrink-0 rounded-sm" src="/avatar-{line.who}.png" alt="" width="36" height="36" />

          <span class="min-w-0 pt-1.5 break-words">
            <span class="text-[#a8d34a]">[Team]</span>
            <span class="text-[#5ba8ff]">{line.who}</span>: {line.text}
          </span>
        </p>
      {/each}
    </div>
  </section>

  <section class="grid gap-4 md:grid-cols-3">
    {#each pillars as p, i (p.title)}
      <div class="card bg-base-200">
        <div class="card-body gap-3 p-7">
          <span class="text-secondary font-mono text-xs">0{i + 1}</span>
          <h2 class="text-xl font-semibold">{p.title}</h2>
          <p class="text-base-content/60 leading-relaxed">{p.body}</p>
        </div>
      </div>
    {/each}
  </section>

  <section class="flex flex-col items-center gap-6 text-center" id="plugins">
    <h2 class="text-3xl font-semibold">Ships with the essentials</h2>
    <div class="flex max-w-3xl flex-wrap justify-center gap-2">
      {#each data.plugins as p (p.name)}
        <span class="badge badge-lg border-secondary/30 bg-secondary/10 text-secondary font-mono" title={p.description}>{p.name}</span>
      {/each}
    </div>
    <p class="text-base-content/60">Want something else? Ask for it.</p>
  </section>

  <section class="mx-auto flex w-full max-w-3xl flex-col gap-8" id="faq">
    <h2 class="text-center text-3xl font-semibold">Questions</h2>
    <div class="flex flex-col gap-2">
      {#each faq as item (item.q)}
        <details class="collapse collapse-plus bg-base-200" name="faq">
          <summary class="collapse-title font-medium">{item.q}</summary>
          <div class="collapse-content text-base-content/65 leading-relaxed">{item.a}</div>
        </details>
      {/each}
    </div>
  </section>

  <footer class="text-base-content/60 flex flex-col gap-2 text-sm md:flex-row md:justify-between">
    <span>AGPL-3.0 · Not affiliated with Facepunch Studios.</span>
    <a class="link" href="https://github.com/bobosneefdev/blueprint">GitHub</a>
  </footer>
</main>
