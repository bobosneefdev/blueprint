<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const lines = $derived(data.diff.split("\n"));
</script>

<a class="link mb-4 inline-block" href="/plugins">← Plugins</a>
<h1 class="mb-4 text-2xl font-semibold">
  {data.name} <code class="text-base-content/60 text-base">{data.commit.slice(0, 7)}</code>
</h1>

<pre class="bg-base-200 rounded-box overflow-x-auto p-4 text-sm">{#each lines as line, i (i)}<span
      class={[line.startsWith("+") && "text-success", line.startsWith("-") && "text-error"]}>{line}
</span>{/each}</pre>
