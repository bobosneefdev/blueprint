<script lang="ts">
  import Chat from "./Chat.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const clock = (h: number) =>
    `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

  const ago = (unix: number) => {
    const d = Math.floor((Date.now() / 1000 - unix) / 86400);

    return d < 1 ? "today" : `${d} day${d === 1 ? "" : "s"} ago`;
  };
</script>

{#if data.world === undefined}
  <div class="alert"><span>Not connected yet. Stats show once the bot reaches the server.</span></div>
{:else}
  {@const w = data.world}
  <div class="stats stats-vertical md:stats-horizontal bg-base-200 border border-white/8">
    <div class="stat">
      <div class="stat-title">Players</div>
      <div class="stat-value text-2xl">{w.players}/{w.maxPlayers}</div>
      <div class="stat-desc">{w.queued} queued</div>
    </div>
    <div class="stat">
      <div class="stat-title">In-game time</div>
      <div class="stat-value text-2xl">{clock(w.hour)}</div>
      <div class="stat-desc">{w.isDay ? "Day" : "Night"}</div>
    </div>
    <div class="stat">
      <div class="stat-title">Wiped</div>
      <div class="stat-value text-2xl">{ago(w.wipeTime)}</div>
      <div class="stat-desc">{new Date(w.wipeTime * 1000).toLocaleDateString()}</div>
    </div>
  </div>

  <div class="card bg-base-200">
    <div class="card-body">
      <h2 class="card-title">Team</h2>
      {#if w.team.length === 0}
        <p class="text-base-content/60 text-sm">No teammates in game yet.</p>
      {:else}
        <ul class="list">
          {#each w.team as m (m.steamId)}
            <li class="list-row items-center">
              <span class={["status", m.online ? (m.alive ? "status-success" : "status-error") : "status-neutral"]}></span>
              <span>{m.name}</span>
              <span class="text-base-content/60 text-sm">{m.online ? (m.alive ? "online" : "dead") : "offline"}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

{#if data.canChat}
  <Chat id={data.id} />
{/if}
