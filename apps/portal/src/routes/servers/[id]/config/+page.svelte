<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();
</script>

<form method="POST" use:enhance class="card bg-base-200">
  <fieldset class="card-body gap-4" disabled={!data.isHost}>
    <h2 class="card-title">Team roles</h2>
    <p class="text-base-content/70 text-sm">
      <b>Interact</b>: ask @{data.botName} and use plugin /commands. <b>Admin</b>: also confirm new
      plugins and turn them on/off. The host is always admin.
    </p>
    {#if !data.isHost}
      <div role="alert" class="alert"><span>Only the host can change roles.</span></div>
    {/if}

    {#if data.members.length === 0}
      <p class="text-base-content/60 text-sm">
        {data.connected ? "No teammates in game yet." : "Not connected yet; teammates show once the server is online."}
      </p>
    {:else}
      <ul class="list">
        {#each data.members as m (m.steamId)}
          <li class="list-row items-center">
            <span class="list-col-grow">{m.name}</span>
            <select class="select select-sm w-36" name="role:{m.steamId}" value={m.role} aria-label="Role for {m.name}">
              <option value="none">None</option>
              <option value="interact">Interact</option>
              <option value="admin">Admin</option>
            </select>
          </li>
        {/each}
      </ul>
    {/if}

    {#if form?.error}<div role="alert" class="alert alert-error"><span>{form.error}</span></div>{/if}
    {#if form?.saved}<div role="alert" class="alert alert-success"><span>Saved.</span></div>{/if}

    {#if data.members.length > 0}
      <div class="card-actions"><button class="btn btn-primary">Save</button></div>
    {/if}
  </fieldset>
</form>
