<script lang="ts">
  import { untrack } from 'svelte'
  import type { JsonValue } from '../../types/cli'
  import { stringifyExactJson } from '../../../shared/exact-number'
  import JsonSyntax from './JsonSyntax.svelte'

  interface Props {
    value: JsonValue
    ariaLabel: string
    onValueChange: (value: JsonValue) => void
  }

  let { value, ariaLabel, onValueChange }: Props = $props()

  function format(source: JsonValue): string {
    return stringifyExactJson(source, 2)
  }

  function parse(source: string): JsonValue {
    return JSON.parse(source) as JsonValue
  }

  let draft = $state('')
  let focused = $state(false)
  let invalid = $state(false)
  let highlightEl = $state<HTMLPreElement | null>(null)
  const errorId = $derived(`${ariaLabel.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}-json-error`)

  $effect(() => {
    const external = format(value)
    if (!focused && !invalid) {
      untrack(() => {
        draft = external
        invalid = false
      })
    }
  })

  function handleInput(event: Event): void {
    draft = (event.target as HTMLTextAreaElement).value
    try {
      onValueChange(parse(draft))
      invalid = false
    } catch {
      invalid = true
    }
  }

  function handleBlur(): void {
    focused = false
    if (!invalid) {
      try {
        draft = format(parse(draft))
      } catch {
        // The invalid branch above owns validation state.
      }
    }
  }

  function syncScroll(event: Event): void {
    if (!highlightEl) return
    const textarea = event.target as HTMLTextAreaElement
    highlightEl.scrollTop = textarea.scrollTop
    highlightEl.scrollLeft = textarea.scrollLeft
  }
</script>

<div class="json-editor" class:invalid>
  <pre bind:this={highlightEl} aria-hidden="true"><JsonSyntax text={draft} />{'\n'}</pre>
  <textarea
    value={draft}
    aria-label={ariaLabel}
    aria-invalid={invalid}
    aria-describedby={invalid ? errorId : undefined}
    spellcheck="false"
    onfocus={() => (focused = true)}
    oninput={handleInput}
    onblur={handleBlur}
    onscroll={syncScroll}
  ></textarea>
</div>
{#if invalid}
  <span class="json-error" id={errorId} role="status">Invalid JSON</span>
{/if}

<style>
  .json-editor {
    position: relative;
    width: 100%;
    min-height: 88px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm, 4px);
    background: var(--color-surface-dark, #0a0a0a);
    overflow: hidden;
  }

  .json-editor:focus-within {
    border-color: var(--color-primary, #00e5ff);
  }

  .json-editor.invalid {
    border-color: var(--color-error, #ef4444);
  }

  pre,
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 88px;
    margin: 0;
    padding: var(--space-2, 8px);
    border: 0;
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: var(--text-xs, 0.625rem);
    line-height: 1.5;
    tab-size: 2;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  pre {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    color: var(--color-text);
  }

  textarea {
    position: relative;
    display: block;
    resize: vertical;
    background: transparent;
    color: transparent;
    caret-color: var(--color-primary, #00e5ff);
    -webkit-text-fill-color: transparent;
    overflow: auto;
  }

  textarea:focus {
    outline: none;
  }

  textarea::selection {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.18));
  }

  .json-error {
    display: block;
    margin-top: 2px;
    color: var(--color-error, #ef4444);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: 9px;
  }
</style>
