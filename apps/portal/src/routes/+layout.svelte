<script lang="ts">
  import "./layout.css";
  import favicon from "#lib/assets/favicon.svg";
  import { page } from "$app/state";
  import type { LayoutProps } from "./$types";

  let { children }: LayoutProps = $props();

  const links = [
    { href: "/", label: "Servers" },
    { href: "/plugins", label: "Plugins" },
  ];
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>better-rust</title>
</svelte:head>

{#if page.url.pathname.startsWith("/auth") || page.url.pathname === "/pair"}
  {@render children()}
{:else}
  <nav class="navbar bg-base-200 px-4">
    <div class="navbar-start gap-2">
      <span class="text-lg font-bold">better-rust</span>
    </div>
    <div class="navbar-center">
      <ul class="menu menu-horizontal">
        {#each links as l (l.href)}
          <li><a href={l.href} class={{ "menu-active": page.url.pathname === l.href }}>{l.label}</a></li>
        {/each}
      </ul>
    </div>
    <div class="navbar-end">
      <form method="POST" action="/auth/logout"><button class="btn btn-ghost btn-sm">Sign out</button></form>
    </div>
  </nav>
  <main class="mx-auto max-w-5xl p-4 md:p-8">
    {@render children()}
  </main>
{/if}
