<script lang="ts">
  import { enhance } from "$app/forms";
  import type { HarnessModel } from "#lib/server/bot.ts";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();

  const NAMES = { claude: "Claude Code", codex: "Codex", pi: "Pi" } as const;

  // Writable deriveds: follow saved settings, editable locally.
  let harness = $derived(data.settings.harness);

  let model = $derived(data.settings.model ?? "");

  let effort = $derived(data.settings.effort ?? "");

  let fast = $derived(data.settings.fast);

  const modelsFor = (list: ReadonlyArray<{ kind: string; models: ReadonlyArray<HarnessModel> }>) =>
    list.find((h) => h.kind === harness)?.models ?? [];

  const pick = (models: ReadonlyArray<HarnessModel>) =>
    models.find((m) => m.id === model) ?? models.find((m) => m.isDefault);
</script>

<h1 class="text-3xl font-bold">Settings</h1>

{#if !data.isHost}
  <div role="alert" class="alert mb-6"><span>Only the host can change settings.</span></div>
{/if}

<div class="flex flex-col gap-6">
  <form method="POST" action="?/save" use:enhance class="card bg-base-200">
    <fieldset class="card-body gap-4" disabled={!data.isHost}>
      <h2 class="card-title">Bot</h2>

      <label class="flex flex-col gap-1">
        <span class="label">Mention name (players type @name)</span>
        <input class="input" name="botName" value={data.settings.botName} required maxlength="16" />
      </label>

      <label class="flex flex-col gap-1">
        <span class="label">AI</span>
        <select class="select" name="harness" bind:value={harness} onchange={() => ((model = ""), (effort = ""), (fast = false))}>
          {#each Object.entries(NAMES) as [k, label] (k)}<option value={k}>{label}</option>{/each}
        </select>
        {#if data.local}
          <a class="link text-sm" href="/setup">Install, update or sign in to an AI</a>
        {/if}
      </label>

      {#await data.harnesses}
        <p class="flex items-center gap-2 text-sm"><span class="loading loading-spinner loading-xs"></span>Loading models from {NAMES[harness]}…</p>
        <input type="hidden" name="model" value={model} />
        <input type="hidden" name="effort" value={effort} />
        {#if fast}<input type="hidden" name="fast" value="on" />{/if}
      {:then harnesses}
        {@const models = typeof harnesses === "string" ? [] : modelsFor(harnesses)}
        {@const current = pick(models)}
        {#if models.length === 0}
          <p class="text-warning text-sm">
            {typeof harnesses === "string" ? `Sandbox unavailable: ${harnesses}` : `${NAMES[harness]} isn't ready, so its models can't be listed. Finish setting it up first.`}
          </p>
          <input type="hidden" name="model" value={model} />
          <input type="hidden" name="effort" value={effort} />
        {:else}
          <label class="flex flex-col gap-1">
            <span class="label">Model</span>
            <select class="select" name="model" bind:value={model} onchange={() => (effort = "")}>
              <option value="">{NAMES[harness]} default</option>
              {#each models as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
              {#if model !== "" && !models.some((m) => m.id === model)}<option value={model}>{model} (saved)</option>{/if}
            </select>
            {#if /haiku|mini|nano|flash|small/i.test(current?.label ?? model)}
              <span class="text-warning text-sm">
                Small models got raid numbers wrong in testing. Use a Sonnet-class model or better.
              </span>
            {/if}
          </label>

          {#if (current?.efforts.length ?? 0) > 0}
            <label class="flex flex-col gap-1">
              <span class="label">Reasoning</span>
              <select class="select" name="effort" bind:value={effort}>
                <option value="">Default{current?.defaultEffort ? ` (${current.defaultEffort})` : ""}</option>
                {#each current?.efforts ?? [] as e (e)}<option value={e}>{e}</option>{/each}
              </select>
            </label>
          {/if}

          {#if current?.fast}
            <label class="label gap-3">
              <input type="checkbox" class="toggle toggle-primary" name="fast" bind:checked={fast} />
              Fast mode (quicker replies, uses your plan's limits faster)
            </label>
          {/if}
        {/if}
      {/await}

      <div class="flex flex-col gap-2">
        <h3 class="font-semibold">Team roles</h3>
        <p class="text-base-content/70 text-sm">
          Per server. <b>Interact</b>: ask @{data.settings.botName} and use plugin /commands.
          <b>Admin</b>: also confirm new plugins and turn them on/off. You are admin everywhere.
        </p>
        {#each data.teams as t (t.id)}
          <div class="bg-base-100 rounded-box p-4">
            <p class="mb-2 font-medium">{t.name}</p>
            {#if t.members.length === 0}
              <p class="text-base-content/60 text-sm">
                {t.connected ? "No teammates in game yet." : "Not connected yet; teammates show once the server is online."}
              </p>
            {:else}
              <ul class="list">
                {#each t.members as m (m.steamId)}
                  <li class="list-row items-center">
                    <span class="list-col-grow">{m.name}</span>
                    <select class="select select-sm w-36" name="role:{t.id}:{m.steamId}" value={m.role} aria-label="Role for {m.name} on {t.name}">
                      <option value="none">None</option>
                      <option value="interact">Interact</option>
                      <option value="admin">Admin</option>
                    </select>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {:else}
          <p class="text-base-content/60 text-sm">Pair a server first.</p>
        {/each}
      </div>

      <label class="flex flex-col gap-1">
        <span class="label">ntfy.sh topic for phone alerts (optional)</span>
        <input class="input font-mono" name="ntfyTopic" value={data.settings.ntfyTopic ?? ""} placeholder="a long random string" />
      </label>

      <label class="flex flex-col gap-1">
        <span class="label">Discord webhook for alerts (optional)</span>
        <input class="input font-mono" name="discordWebhook" type="url" value={data.settings.discordWebhook ?? ""} placeholder="https://discord.com/api/webhooks/…" />
        <span class="text-base-content/60 text-sm">Discord: Server Settings → Integrations → Webhooks → Copy URL. Keep it secret.</span>
      </label>

      {#if form?.error}<div role="alert" class="alert alert-error"><span>{form.error}</span></div>{/if}
      {#if form?.saved}<div role="alert" class="alert alert-success"><span>Saved.</span></div>{/if}

      <div class="card-actions"><button class="btn btn-primary">Save</button></div>
    </fieldset>
  </form>

  <form method="POST" action="?/import" use:enhance class="card bg-base-200">
    <fieldset class="card-body gap-4" disabled={data.role !== "admin"}>
      <h2 class="card-title">Import from gallery</h2>
      <label class="flex flex-col gap-1">
        <span class="label">Raw plugin URL</span>
        <input class="input font-mono" name="url" type="url" required placeholder="https://raw.githubusercontent.com/…/plugin.json" />
      </label>
      {#if form?.importError}<div role="alert" class="alert alert-error"><span>{form.importError}</span></div>{/if}
      {#if form?.imported}<div role="alert" class="alert alert-success"><span>Imported and active.</span></div>{/if}
      <div class="card-actions"><button class="btn">Validate &amp; import</button></div>
    </fieldset>
  </form>
</div>
