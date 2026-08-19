<script lang="ts">
  interface Props {
    filePath?: string
    sourceUrl?: string
  }

  let { filePath, sourceUrl }: Props = $props()
</script>

<div data-testid="video-viewer" data-file-path={filePath} data-source-url={sourceUrl}></div>
