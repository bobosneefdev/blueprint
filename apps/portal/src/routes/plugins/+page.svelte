<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<h1 class="text-3xl font-bold">Plugins</h1>

<div class="flex flex-col gap-4">
  {#each data.plugins as p (p.name)}
    <div class="card bg-base-200">
      <div class="card-body gap-3">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 class="card-title">
              {p.name} <span class="badge badge-sm">{p.trigger}</span>
              <a class="btn btn-ghost btn-xs" href="/plugins/{p.name}/export.json" download>Export</a>
            </h2>
            <p class="text-base-content/70">{p.description}</p>
          </div>
          <form method="POST" action="?/toggle" use:enhance>
            <input type="hidden" name="name" value={p.name} />
            <input type="hidden" name="enabled" value={String(!p.enabled)} />
            <label class="label">
              <input type="checkbox" class="toggle" checked={p.enabled} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
              {p.enabled ? "On" : "Off"}
            </label>
          </form>
        </div>
        {#if p.heuristic}
          <div role="alert" class="alert alert-warning alert-soft text-sm">
            <span>Heuristic: {p.heuristic}</span>
          </div>
        {/if}
        {#if p.history.length > 1}
          <details class="collapse collapse-arrow bg-base-100">
            <summary class="collapse-title text-sm">History ({p.history.length})</summary>
            <ul class="collapse-content list">
              {#each p.history as h (h.commit)}
                <li class="list-row items-center">
                  <a class="link font-mono text-xs" href="/plugins/{p.name}/{h.commit}">{h.commit.slice(0, 7)}</a>
                  <span class="text-sm">{h.message}</span>
                  <form method="POST" action="?/rollback" use:enhance>
                    <input type="hidden" name="name" value={p.name} />
                    <input type="hidden" name="commit" value={h.commit} />
                    <button class="btn btn-xs">Restore</button>
                  </form>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>
    </div>
  {:else}
    <div class="alert"><span>No plugins yet. Ask in team chat: <code>@bot alert me when cargo spawns</code></span></div>
  {/each}
</div>
