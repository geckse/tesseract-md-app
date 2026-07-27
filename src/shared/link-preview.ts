export interface ExternalLinkPreview {
  kind: 'external'
  url: string
  finalUrl: string
  domain: string
  title: string | null
  description: string | null
  siteName: string | null
}

export interface LocalLinkPreview {
  kind: 'local'
  path: string
  title: string
  description: string | null
  modifiedAt: number
}

export type LinkPreviewData = ExternalLinkPreview | LocalLinkPreview
