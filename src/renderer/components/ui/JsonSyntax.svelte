<script lang="ts">
  import { tokenizeJson } from '../../lib/json-syntax'

  interface Props {
    text: string
    ariaLabel?: string
  }

  let { text, ariaLabel }: Props = $props()
  const tokens = $derived(tokenizeJson(text))
</script>

<span class="json-syntax" aria-label={ariaLabel}>
  {#each tokens as token, index (`${index}:${token.kind}:${token.text}`)}
    <span class="json-token {token.kind}">{token.text}</span>
  {/each}
</span>

<style>
  .json-syntax {
    white-space: inherit;
  }

  .key {
    color: var(--color-info, #60a5fa);
  }

  .string {
    color: var(--color-success, #34d399);
  }

  .number {
    color: var(--color-warning, #f59e0b);
  }

  .boolean {
    color: var(--color-primary, #00e5ff);
  }

  .null {
    color: var(--color-text-dim, #8b8b94);
    font-style: italic;
  }

  .punctuation {
    color: var(--color-text-syntax, #526366);
  }

  .invalid {
    color: var(--color-error, #ef4444);
    text-decoration: wavy underline;
    text-decoration-color: var(--color-error, #ef4444);
  }
</style>
