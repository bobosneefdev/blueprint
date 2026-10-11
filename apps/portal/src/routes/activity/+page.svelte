<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const time = (ms: number) => new Date(ms).toLocaleString();
</script>

<h1 class="text-3xl font-bold">Activity</h1>

{#if data.entries.length === 0}
  <div class="alert"><span>No plugin errors or throttling. All quiet.</span></div>
{:else}
  <div class="overflow-x-auto">
    <table class="table">
      <thead><tr><th>When</th><th>Server</th><th>Plugin</th><th>What happened</th></tr></thead>
      <tbody>
        {#each data.entries as e (e.at + e.plugin + e.message)}
          <tr>
            <td class="whitespace-nowrap">{time(e.at)}</td>
            <td>{e.server}</td>
            <td class="font-mono">{e.plugin}</td>
            <td>{e.message}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
