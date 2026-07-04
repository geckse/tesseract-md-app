<script lang="ts">
  // Generic stub for heavy child components in unit tests. Renders a marker
  // div and mirrors the props relevant to assertions.
  const props: Record<string, unknown> = $props()
</script>

<div
  data-testid="stub-component"
  data-terminal-id={typeof props.terminalId === 'string' ? props.terminalId : undefined}
></div>
