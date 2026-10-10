<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">Settings</h1>

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
        <span class="label">AI harness</span>
        <select class="select" name="harness" value={data.settings.harness}>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="pi">Pi</option>
        </select>
      </label>

      <label class="flex flex-col gap-1">
        <span class="label">Model (optional)</span>
        <input class="input" name="model" value={data.settings.model ?? ""} placeholder="harness default" />
      </label>

      <label class="flex flex-col gap-1">
        <span class="label">Allowlist: SteamID64s who can use the AI and this portal</span>
        <textarea class="textarea font-mono" name="allowlist" rows="3">{data.settings.allowlist.join("\n")}</textarea>
      </label>

      <label class="flex flex-col gap-1">
        <span class="label">ntfy.sh topic for phone alerts (optional)</span>
        <input class="input font-mono" name="ntfyTopic" value={data.settings.ntfyTopic ?? ""} placeholder="a long random string" />
      </label>

      {#if form?.error}<div role="alert" class="alert alert-error"><span>{form.error}</span></div>{/if}
      {#if form?.saved}<div role="alert" class="alert alert-success"><span>Saved.</span></div>{/if}

      <div class="card-actions"><button class="btn btn-primary">Save</button></div>
    </fieldset>
  </form>

  <form method="POST" action="?/import" use:enhance class="card bg-base-200">
    <fieldset class="card-body gap-4" disabled={!data.isHost}>
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
