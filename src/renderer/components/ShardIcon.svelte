<script lang="ts">
  interface Props {
    size?: number | string
    label?: string
  }

  let { size = '1em', label }: Props = $props()
</script>

<svg
  class="shard-icon"
  data-shard-icon="faceted-gem-outline"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  <path d="m12 1.75 7 5.75v9L12 22.25 5 16.5v-9l7-5.75Z" />
  <path d="m12 6 4 3.5v5L12 18l-4-3.5v-5L12 6Z" />
  <path d="M12 1.75V6M19 7.5l-3 2M19 16.5l-3-2M12 22.25V18M5 16.5l3-2M5 7.5l3 2" />
</svg>

<style>
  .shard-icon {
    display: inline-block;
    flex: none;
    overflow: visible;
    vertical-align: middle;
  }
</style>
