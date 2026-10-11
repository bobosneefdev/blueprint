<script lang="ts">
  import { page } from "$app/state";
  import type { LayoutProps } from "./$types";

  let { data, children }: LayoutProps = $props();

  let tabs = $derived([
    { href: `/servers/${data.id}`, label: "Overview" },
    { href: `/servers/${data.id}/map`, label: "Map" },
    { href: `/servers/${data.id}/config`, label: "Config" },
  ]);
</script>

<div class="flex flex-col gap-4">
  <a href="/" class="link link-hover text-base-content/60 text-sm">← Servers</a>
  <h1 class="text-3xl font-semibold">{data.name}</h1>
  <div role="tablist" class="tabs tabs-border">
    {#each tabs as t (t.href)}
      <a role="tab" href={t.href} class={["tab", page.url.pathname === t.href && "tab-active"]}>{t.label}</a>
    {/each}
  </div>
</div>

{@render children()}
