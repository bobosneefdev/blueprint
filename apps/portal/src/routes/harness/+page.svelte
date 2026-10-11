<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();

  let harness = $derived(data.harness);
</script>

<div class="mx-auto flex max-w-xl flex-col gap-6 p-6 md:p-10">
  <h1 class="text-2xl font-bold">Connect your AI</h1>
  <p class="text-base-content/70">
    Credentials go straight into the AI's sandbox on this PC. Blueprint doesn't store or send them.
  </p>

  <form method="POST" use:enhance class="card bg-base-200">
    <div class="card-body gap-4">
      <label class="flex flex-col gap-1">
        <span class="label">Harness</span>
        <select class="select" name="harness" bind:value={harness}>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="pi">Pi</option>
        </select>
      </label>

      {#if harness === "claude"}
        <label class="flex flex-col gap-1">
          <span class="label">Credential</span>
          <select class="select" name="kind">
            <option value="oauthToken">Claude subscription token (run `claude setup-token` in a terminal)</option>
            <option value="apiKey">Anthropic API key</option>
          </select>
        </label>
      {:else if harness === "codex"}
        <input type="hidden" name="kind" value="apiKey" />
        <p class="text-sm">OpenAI API key. ChatGPT-plan sign-in is coming soon.</p>
      {:else}
        <label class="flex flex-col gap-1">
          <span class="label">Provider variable</span>
          <select class="select" name="envVar">
            <option value="OPENROUTER_API_KEY">OpenRouter</option>
            <option value="ANTHROPIC_API_KEY">Anthropic</option>
            <option value="OPENAI_API_KEY">OpenAI</option>
            <option value="GEMINI_API_KEY">Google Gemini</option>
          </select>
        </label>
      {/if}

      <label class="flex flex-col gap-1">
        <span class="label">Token / key</span>
        <input class="input font-mono" name="value" type="password" autocomplete="off" required />
      </label>

      {#if form?.error}<div role="alert" class="alert alert-error"><span>{form.error}</span></div>{/if}
      {#if form?.saved}<div role="alert" class="alert alert-success"><span>Saved to the sandbox.</span></div>{/if}

      <div class="card-actions"><button class="btn btn-primary">Save</button></div>
    </div>
  </form>
  <a class="link" href="/">Back</a>
</div>
