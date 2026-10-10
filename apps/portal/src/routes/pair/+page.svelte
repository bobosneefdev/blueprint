<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();

  let busy = $state(false);
</script>

<div class="mx-auto flex max-w-xl flex-col gap-6 p-6 md:p-10">
  <h1 class="text-2xl font-bold">Connect Rust+</h1>

  <ol class="steps steps-vertical">
    <li class={["step", (data.signedIn || form?.pairedAs) && "step-primary"]}>Sign in with Steam (opens on this PC)</li>
    <li class="step">In game: ESC → Rust+ → Pair with Server</li>
    <li class="step">Pair smart switches and alarms the same way</li>
  </ol>

  {#if form?.error}
    <div role="alert" class="alert alert-error"><span>{form.error}</span></div>
  {/if}

  {#if form?.pairedAs || data.signedIn}
    <div role="alert" class="alert alert-success">
      <span>Signed in. Now pair a server from inside Rust; it shows up here automatically.</span>
    </div>
    <a class="btn" href="/">Go to servers</a>
  {:else}
    <p class="text-base-content/70">
      A browser window opens on Facepunch's Rust+ sign-in page. Read their notice and continue
      with Steam there. better-rust never sees your Steam password.
    </p>
    <form
      method="POST"
      use:enhance={() => {
        busy = true;

        return async ({ update }) => {
          await update();
          busy = false;
        };
      }}
    >
      <button class="btn btn-primary" disabled={busy}>
        {#if busy}<span class="loading loading-spinner"></span>Waiting for sign-in…{:else}Sign in with Steam{/if}
      </button>
    </form>
  {/if}
</div>
