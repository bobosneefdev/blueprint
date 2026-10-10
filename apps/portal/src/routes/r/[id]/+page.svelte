<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<article class="card bg-base-200">
  <div class="card-body whitespace-pre-wrap">{data.text}</div>
</article>
