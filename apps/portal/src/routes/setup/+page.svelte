<script lang="ts">
  import { enhance, type SubmitFunction } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import type { HarnessStatus } from "#lib/server/bot.ts";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();

  const NAMES = { claude: "Claude Code", codex: "Codex", pi: "Pi" } as const;

  const BLURB = {
    claude: "Anthropic. Sign in with your Claude subscription, or use an API key.",
    codex: "OpenAI. Sign in with your ChatGPT plan, or use an API key.",
    pi: "Open source. Bring an API key from OpenRouter, Anthropic, OpenAI or Google.",
  } as const;

  const PI_PROVIDERS = [
    ["OPENROUTER_API_KEY", "OpenRouter"],
    ["ANTHROPIC_API_KEY", "Anthropic"],
    ["OPENAI_API_KEY", "OpenAI"],
    ["GEMINI_API_KEY", "Google Gemini"],
  ] as const;

  /** Which form is mid-submit, so only its button spins. */
  let busy = $state<string | undefined>(undefined);

  const track =
    (id: string): SubmitFunction =>
    () => {
      busy = id;

      return async ({ update }) => {
        await update();
        busy = undefined;
      };
    };

  const usable = (h: HarnessStatus) => h.state !== "missing" && h.state !== "outdated" && h.signedIn;

  // A host exists once Rust+ sign-in has run; its token can later expire (step 1 shows that).
  let hostSet = $derived(data.pairing.hostSteamId !== "" || form?.paired === true);

  let rustDone = $derived(data.pairing.signedIn || form?.paired === true);

  // AI sign-in finishes in another tab and pairing happens in game: poll while either is pending.
  $effect(() => {
    const signingIn = data.login?.state === "starting" || data.login?.state === "waiting";

    if (!signingIn && !(rustDone && data.servers === 0)) return;

    const t = setInterval(() => void invalidateAll(), signingIn ? 2000 : 5000);

    return () => clearInterval(t);
  });
</script>

{#snippet keyForm(kind: HarnessStatus["kind"])}
  <form method="POST" action="?/key" use:enhance={track(`key-${kind}`)} class="flex flex-wrap gap-2">
    <input type="hidden" name="kind" value={kind} />
    {#if kind === "pi"}
      <select class="select select-sm w-fit" name="envVar" aria-label="Provider">
        {#each PI_PROVIDERS as [v, label] (v)}<option value={v}>{label}</option>{/each}
      </select>
    {/if}
    <input class="input input-sm min-w-0 flex-1 font-mono" name="value" type="password" autocomplete="off" placeholder="API key" aria-label="API key" required />
    <button class="btn btn-sm" disabled={busy === `key-${kind}`}>Save key</button>
  </form>
{/snippet}

<svelte:head><title>Set up Blueprint</title></svelte:head>

<main class="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-12 md:px-8 md:py-16">
  <header class="flex flex-col gap-3">
    <span class="badge badge-outline">Setup · runs on this PC only</span>
    <h1 class="text-4xl leading-tight font-semibold text-balance">
      Three steps and your team chat <span class="text-secondary">takes requests.</span>
    </h1>
  </header>

  {#if form?.error}
    <div role="alert" class="alert alert-error"><span>{form.error}</span></div>
  {/if}

  <!-- 1. Rust+ -->
  <section class="card bg-base-200">
    <div class="card-body gap-4">
      <div class="flex items-center gap-3">
        <span class={["badge", rustDone ? "badge-success" : "badge-primary"]}>{rustDone ? "✓" : "1"}</span>
        <h2 class="card-title">Connect Rust+</h2>
      </div>

      {#if rustDone}
        <p class="text-base-content/75">Signed in to Rust+ as the host. This also signed you in here.</p>
      {:else}
        {#if hostSet}
          <div role="alert" class="alert alert-warning"><span>Your Rust+ sign-in expired. Sign in again to keep getting pair requests.</span></div>
        {/if}
        <p class="text-base-content/75">
          A browser window opens on Facepunch's Rust+ sign-in page. Read their notice and continue
          with Steam there. Blueprint never sees your Steam password.
        </p>
        <form method="POST" action="?/pair" use:enhance={track("pair")}>
          <button class="btn btn-primary" disabled={busy === "pair"}>
            {#if busy === "pair"}<span class="loading loading-spinner"></span>Waiting for sign-in…{:else}Sign in with Steam{/if}
          </button>
        </form>
      {/if}
    </div>
  </section>

  <!-- 2. AI -->
  <section class={["card bg-base-200", !hostSet && "opacity-50"]}>
    <div class="card-body gap-4">
      <div class="flex items-center gap-3">
        <span class="badge badge-primary">2</span>
        <h2 class="card-title">Pick the AI that writes your plugins</h2>
      </div>
      <p class="text-base-content/75">
        It runs in a locked-down sandbox on this PC. Sign-ins and keys stay inside it.
      </p>

      {#if !hostSet}
        <p class="text-sm">Finish step 1 first.</p>
      {:else}
        {#await data.harnesses}
          <p class="flex items-center gap-2"><span class="loading loading-spinner"></span>Checking the sandbox… the first time takes a minute.</p>
        {:then harnesses}
          {#if typeof harnesses === "string"}
            <div role="alert" class="alert alert-error"><span>Sandbox unavailable: {harnesses}</span></div>
          {:else}
            <div class="flex flex-col gap-3">
              {#each harnesses as h (h.kind)}
                {@const chosen = data.settings.harness === h.kind}
                {@const login = data.login?.kind === h.kind ? data.login : undefined}
                <div class={["rounded-box border p-4", chosen && usable(h) ? "border-primary" : "border-base-300"]}>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex flex-col">
                      <span class="font-semibold">{NAMES[h.kind]}</span>
                      <span class="text-base-content/60 text-sm">{BLURB[h.kind]}</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      {#if h.state === "missing"}
                        <span class="badge badge-ghost">Not installed</span>
                      {:else}
                        <span class={["badge", h.state === "ok" ? "badge-success" : "badge-warning"]}>v{h.version}</span>
                        <span class={["badge", h.signedIn ? "badge-success" : "badge-ghost"]}>{h.signedIn ? "Signed in" : "Signed out"}</span>
                      {/if}
                      {#if chosen && usable(h)}<span class="badge badge-primary">In use</span>{/if}
                    </div>
                  </div>

                  <div class="mt-3 flex flex-col gap-3">
                    {#if h.state !== "ok"}
                      <form method="POST" action="?/install" use:enhance={track(`install-${h.kind}`)} class="flex flex-wrap items-center gap-3">
                        <input type="hidden" name="kind" value={h.kind} />
                        <button class={["btn btn-sm", h.state === "ahead" ? "btn-ghost" : "btn-primary"]} disabled={busy === `install-${h.kind}`}>
                          {#if busy === `install-${h.kind}`}<span class="loading loading-spinner loading-xs"></span>{/if}
                          {h.state === "missing" ? "Install" : h.state === "outdated" ? "Upgrade" : "Downgrade"} to v{h.approved.pin}
                        </button>
                        <span class="text-base-content/60 text-sm">
                          {#if h.state === "outdated"}Required: v{h.version} is older than Blueprint supports (v{h.approved.min}+).
                          {:else if h.state === "ahead"}v{h.version} is newer than tested (v{h.approved.pin}). It may work; downgrade if replies break.
                          {/if}
                        </span>
                      </form>
                    {/if}

                    {#if h.state !== "missing" && h.state !== "outdated" && !h.signedIn}
                      {#if h.kind !== "pi"}
                        {#if login?.state === "waiting" && login.url}
                          <div class="bg-base-100 rounded-box flex flex-col gap-3 p-4">
                            <a class="btn btn-primary btn-sm w-fit" href={login.url} target="_blank" rel="noreferrer">
                              Open {h.kind === "claude" ? "claude.com" : "openai.com"} sign-in
                            </a>
                            {#if login.code}
                              <p>Enter this code there: <code class="kbd kbd-lg">{login.code}</code></p>
                              <p class="text-base-content/60 flex items-center gap-2 text-sm"><span class="loading loading-dots loading-xs"></span>Waiting for you to approve…</p>
                            {:else}
                              <form method="POST" action="?/code" use:enhance={track("code")} class="join">
                                <input class="input input-sm join-item font-mono" name="code" placeholder="Paste the code shown after approving" autocomplete="off" required />
                                <button class="btn btn-sm join-item" disabled={busy === "code"}>Continue</button>
                              </form>
                            {/if}
                          </div>
                        {:else}
                          {#if login?.state === "failed"}<p class="text-error text-sm">{login.message}</p>{/if}
                          <form method="POST" action="?/login" use:enhance={track(`login-${h.kind}`)}>
                            <input type="hidden" name="kind" value={h.kind} />
                            <button class="btn btn-primary btn-sm" disabled={busy === `login-${h.kind}` || login?.state === "starting"}>
                              {#if busy === `login-${h.kind}`}<span class="loading loading-spinner loading-xs"></span>{/if}
                              Sign in with {h.kind === "claude" ? "Claude" : "ChatGPT"}
                            </button>
                          </form>
                        {/if}
                      {/if}

                      {#if h.kind === "pi"}
                        {@render keyForm(h.kind)}
                      {:else}
                        <details class="collapse collapse-arrow bg-base-100">
                          <summary class="collapse-title text-sm">Use an API key instead</summary>
                          <div class="collapse-content">{@render keyForm(h.kind)}</div>
                        </details>
                      {/if}
                    {/if}

                    {#if usable(h) && !chosen}
                      <form method="POST" action="?/choose" use:enhance={track(`choose-${h.kind}`)}>
                        <input type="hidden" name="kind" value={h.kind} />
                        <button class="btn btn-primary btn-sm">Use {NAMES[h.kind]}</button>
                      </form>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {/await}
      {/if}
    </div>
  </section>

  <!-- 3. Pair -->
  <section class={["card bg-base-200", !rustDone && "opacity-50"]}>
    <div class="card-body gap-4">
      <div class="flex items-center gap-3">
        <span class={["badge", data.servers > 0 ? "badge-success" : "badge-primary"]}>{data.servers > 0 ? "✓" : "3"}</span>
        <h2 class="card-title">Pair your server in game</h2>
      </div>
      <ol class="text-base-content/75 list-inside list-decimal">
        <li>In Rust, press <kbd class="kbd kbd-sm">ESC</kbd> → <b>Rust+</b> → <b>Pair with Server</b>.</li>
        <li>Pair smart switches and alarms the same way (hold <kbd class="kbd kbd-sm">E</kbd> on them).</li>
        <li>Say <code>@{data.settings.botName} hi</code> in team chat.</li>
      </ol>
      {#if data.servers > 0}
        <a class="btn btn-primary w-fit" href="/">Open your servers</a>
      {:else if rustDone}
        <p class="text-base-content/60 flex items-center gap-2 text-sm"><span class="loading loading-dots loading-xs"></span>Your server shows up here once paired.</p>
      {/if}
    </div>
  </section>
</main>
