<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let failed = $state("");

  /** Polls positions every 5s while the page is open; the bot already polls Rust+ centrally. */
  const live = (canvas: HTMLCanvasElement) => {
    let stop = false;
    let destroy = () => {};

    void (async () => {
      try {
        // Browser-only: three/webgpu touches navigator/GPU globals at import time.
        const { mount, decodeSnapshot } = await import("#lib/map.ts");
        const view = await mount(canvas, `/map/${data.id}/image.jpg`, data.oceanMargin);

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
  <canvas {@attach live} class="bg-base-200 rounded-box aspect-square w-full"></canvas>
{/if}
