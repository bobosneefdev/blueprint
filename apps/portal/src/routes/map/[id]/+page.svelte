<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let failed = $state("");

  let waiting = $state(true);

  /** Polls positions every 5s while the page is open; the bot already polls Rust+ centrally. */
  const live = (canvas: HTMLCanvasElement) => {
    let stop = false;
    let destroy = () => {};

    void (async () => {
      try {
        // Browser-only: three/webgpu touches navigator/GPU globals at import time.
        const { mount, decodeSnapshot } = await import("#lib/map.ts");
        // Rust+ can be mid-reconnect; retry the image instead of failing the page.
        let img = await fetch(`/map/${data.id}/image.jpg`);

        while (!img.ok && !stop) {
          await new Promise((r) => setTimeout(r, 5000));
          img = await fetch(`/map/${data.id}/image.jpg`);
        }

        if (stop) return;

        waiting = false;

        const url = URL.createObjectURL(await img.blob());
        const view = await mount(canvas, url, Number(img.headers.get("x-ocean-margin") ?? 0));

        URL.revokeObjectURL(url);

        destroy = view.destroy;

        while (!stop) {
          const res = await fetch(`/map/${data.id}/world.json`);

          if (res.ok) view.update(decodeSnapshot(await res.text()));

          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch (e) {
        failed = e instanceof Error ? e.message : String(e);
      }
    })();

    return () => {
      stop = true;
      destroy();
    };
  };
</script>

<div class="mb-4 flex flex-col gap-1">
  <h1 class="text-2xl font-bold">{data.name}</h1>
  <p class="text-base-content/60 text-sm">
    <span class="text-success">●</span> online · <span class="text-error">●</span> dead ·
    <span class="text-base-content/40">●</span> offline · larger dots are cargo, heli, chinook, crates
  </p>
</div>

{#if failed}
  <div role="alert" class="alert alert-error"><span>Map unavailable: {failed}</span></div>
{:else}
  {#if waiting}
    <p class="text-base-content/60 mb-2 text-sm">Waiting for the map from Rust+…</p>
  {/if}
  <canvas {@attach live} class="bg-base-200 rounded-box aspect-square w-full"></canvas>
{/if}
