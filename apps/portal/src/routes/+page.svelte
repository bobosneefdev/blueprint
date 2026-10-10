<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">Servers</h1>

{#if data.servers.length === 0}
  <div class="alert">
    <span>No servers paired yet. In game: ESC → Rust+ → Pair with Server.</span>
  </div>
{/if}

<div class="grid gap-4 md:grid-cols-2">
  {#each data.servers as s (s.id)}
    <div class="card bg-base-200">
      <div class="card-body">
        <div class="flex items-center justify-between gap-2">
          <h2 class="card-title">{s.name}</h2>
          <a class="btn btn-sm" href="/map/{s.id}">Map</a>
        </div>
        <div class="stats">
          <div class="stat">
            <div class="stat-title">Players</div>
            <div class="stat-value text-2xl">{s.players}</div>
            <div class="stat-desc">{s.queued} queued</div>
          </div>
        </div>
        <ul class="list">
          {#each s.team as m (m.steamId)}
            <li class="list-row items-center">
              <span class={["status", m.online ? (m.alive ? "status-success" : "status-error") : "status-neutral"]}></span>
              <span>{m.name}</span>
              <span class="text-base-content/60 text-sm">{m.online ? (m.alive ? "online" : "dead") : "offline"}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/each}
</div>
