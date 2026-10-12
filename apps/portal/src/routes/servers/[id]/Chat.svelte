<script lang="ts">
  let { id }: { id: string } = $props();

  type Line = { steamId: string; name: string; text: string; time: number };

  let lines = $state<Line[]>([]);

  let text = $state("");

  let sending = $state(false);

  let failed = $state("");

  const load = async () => {
    const res = await fetch(`/servers/${id}/chat.json`).catch(() => undefined);

    if (res?.ok) {
      lines = await res.json();
      failed = "";
    } else failed = "Chat unavailable until the bot reconnects.";
  };

  /** Polls every 3s while open; the bot caches getTeamChat so tabs share one Rust+ request. */
  const poll = (log: HTMLElement) => {
    let stop = false;

    void (async () => {
      while (!stop) {
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;

        await load();

        if (atBottom) requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));

        await new Promise((r) => setTimeout(r, 3000));
      }
    })();

    return () => {
      stop = true;
    };
  };

  const send = async (e: SubmitEvent) => {
    e.preventDefault();

    if (text.trim() === "") return;

    sending = true;

    const res = await fetch(`/servers/${id}/chat.json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => undefined);

    sending = false;

    if (res?.ok) {
      text = "";
      await load();
    } else failed = "Couldn't send. Try again.";
  };

  const at = (t: number) =>
    new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
</script>

<div class="card bg-base-200">
  <div class="card-body">
    <h2 class="card-title">Team chat</h2>
    <div {@attach poll} class="flex h-72 flex-col gap-1 overflow-y-auto text-sm" aria-live="polite">
      {#each lines as l, i (i)}
        <p>
          <span class="text-base-content/40">{at(l.time)}</span>
          <span class="font-medium">{l.name}</span>
          <span class="break-words">{l.text}</span>
        </p>
      {:else}
        <p class="text-base-content/60">No messages yet.</p>
      {/each}
    </div>
    {#if failed}
      <p role="alert" class="text-error text-sm">{failed}</p>
    {/if}
    <form onsubmit={send} class="join w-full">
      <input
        bind:value={text}
        aria-label="Message"
        placeholder="Message your team"
        maxlength="100"
        class="input join-item w-full"
      />
      <button class="btn btn-primary join-item" disabled={sending || text.trim() === ""}>Send</button>
    </form>
  </div>
</div>
