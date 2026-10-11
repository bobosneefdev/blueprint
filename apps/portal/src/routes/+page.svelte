<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<h1 class="text-3xl font-semibold">Servers</h1>

{#if data.servers.length === 0}
  <div class="alert">
    <span>No servers paired yet. In game: ESC → Rust+ → Pair with Server.</span>
    {#if data.setupLink}<a class="btn btn-sm btn-primary" href="/setup">Finish setup</a>{/if}
  </div>
{/if}

<div class="grid gap-4 md:grid-cols-2">
  {#each data.servers as s (s.id)}
    <a class="card bg-base-200" href="/servers/{s.id}">
      <div class="card-body">
        <h2 class="card-title">{s.name}</h2>
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
    </a>
  {/each}
</div>
