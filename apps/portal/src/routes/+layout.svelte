<script lang="ts">
  import "./layout.css";
  import favicon from "#lib/assets/favicon.svg";
  import { page } from "$app/state";
  import type { LayoutProps } from "./$types";

  let { children }: LayoutProps = $props();

  const links = [
    { href: "/", label: "Servers" },
    { href: "/plugins", label: "Plugins" },
    { href: "/activity", label: "Activity" },
    { href: "/settings", label: "Settings" },
  ];

  // The wizard and the sign-in redirects are full-page; everything else gets the nav.
  let bare = $derived(page.route.id === "/setup" || page.url.pathname.startsWith("/auth"));
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Blueprint</title>
</svelte:head>

{#if bare}
  {@render children()}
{:else}
  <header class="border-base-300 border-b">
    <nav class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-8">
      <a href="/" class="flex items-center gap-2 font-bold">
        <img src={favicon} alt="" class="size-7" />
        Blueprint
      </a>
      <ul class="menu menu-horizontal flex-1 p-0">
        {#each links as l (l.href)}
          <li><a href={l.href} class={{ "menu-active": page.url.pathname === l.href }}>{l.label}</a></li>
        {/each}
      </ul>
      <form method="POST" action="/auth/logout"><button class="btn btn-ghost btn-sm">Sign out</button></form>
    </nav>
  </header>
  <main class="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 md:px-8">
    {@render children()}
  </main>
{/if}
