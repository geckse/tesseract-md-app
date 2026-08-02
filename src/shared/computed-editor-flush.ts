/**
 * Main ↔ renderer protocol used before a computed-field definition mutates
 * the schema overlay. The three phases let main reject ambiguous duplicate
 * editors before any renderer writes to disk, then prove every window is clean.
 */
export const COMPUTED_EDITOR_FLUSH_REQUEST_CHANNEL = 'computed:editor-flush-request'
export const COMPUTED_EDITOR_FLUSH_RESPONSE_CHANNEL = 'computed:editor-flush-response'
export const COMPUTED_SCHEMA_APPLIED_CHANNEL = 'computed:schema-applied'

export type ComputedEditorFlushPhase = 'inspect' | 'flush' | 'verify'

export interface ComputedEditorFlushRequest {
  requestId: string
  phase: ComputedEditorFlushPhase
  collectionId: string
  collectionPath: string
}

export interface ComputedEditorFlushDocument {
  tabId: string
  path: string
}

export interface ComputedEditorFlushBlocker {
  tabId?: string
  path?: string
  reason: string
}

export interface ComputedEditorFlushResponse {
  requestId: string
  phase: ComputedEditorFlushPhase
  collectionId: string
  /** Whether this renderer currently owns workspace state for the collection. */
  applies: boolean
  ok: boolean
  dirtyDocuments: ComputedEditorFlushDocument[]
  blockers: ComputedEditorFlushBlocker[]
}

/** Sent only after a computed transaction or its rollback recompute succeeded. */
export interface ComputedSchemaAppliedEvent {
  root: string
  /** Present only for a successful computed-definition rename. */
  rename?: {
    scope: string | null
    oldKey: string
    newKey: string
  }
}
