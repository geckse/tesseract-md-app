# PRD: Phase 49 — Lookup and Rollup Computed Fields

## Overview

Phase 49 adds two schema-defined, CLI-computed field types to the desktop app:

- **Lookup** follows one outgoing Relation and retrieves a field from each related document.
- **Rollup** collects values from outgoing or incoming relations and evaluates a Formula-style expression over the reserved `values` array.

Lookup and Rollup are implemented by the same built-in CLI module, `lookup_rollup`. The existing `formula` module remains independent. Definitions live in `.markdownvdb.schema.yml`; successful values are materialized into Markdown frontmatter. Frontmatter remains the sole value authority in the app. Module caches and diagnostics can explain a value but never replace it.

This phase does not bump the app, CLI, index, or saved-view version. Capability detection uses `mdvdb modules list`.

## Product Examples

### Outgoing Lookup

Contacts contain a Relation named `client` targeting `clients`. A `client_domain` Lookup retrieves the related Client's `domain` field. A scalar relation produces a scalar value; a list relation produces an ordered list with duplicates retained.

### Incoming Rollup

Invoices contain a Relation named `client` targeting `clients` and a Formula field named `total`. A Client `invoice_total` Rollup scans the `invoices` scope for documents whose `client` points to the Client, collects their materialized `total` values, and sums them.

## Canonical Overlay Contract

Outgoing Relation targets are derived from the selected Relation field's existing `target` / emitted `relation_target`. They do not persist `relation_scope` or `relation_direction`; outgoing is the default.

```yaml
scopes:
  contacts:
    fields:
      client_domain:
        field_type: lookup
        relation_field: client
        target_field: domain

  clients:
    fields:
      invoice_total:
        field_type: rollup
        relation_field: client
        target_field: total
        relation_direction: incoming
        relation_scope: invoices
        formula: values.reduce((sum, value) => sum + value, 0)
        result_type: number

      account_value:
        field_type: rollup
        relation_field: accounts
        target_field: value
        formula: values.reduce((sum, value) => sum + value, 0)
        result_type: number
```

Rules:

- `field_type` is `lookup` or `rollup` in YAML and `Lookup` or `Rollup` in CLI JSON.
- `relation_field` and `target_field` are required non-empty field names.
- Lookup is outgoing only.
- Rollup defaults to outgoing. Incoming Rollup requires `relation_direction: incoming` and a slash-less relative `relation_scope`.
- Outgoing definitions must omit `relation_direction` and `relation_scope`.
- Rollup requires `formula` and `result_type`; its formulas use the existing sandbox and result-type vocabulary.
- Presets are authoring shortcuts only. The persisted value is always a formula.

Schema and collection fields add nullable `relation_field`, `target_field`, `relation_direction`, and `relation_scope`. Public CLI JSON serializes effective directions as PascalCase `Outgoing` / `Incoming` (including `Outgoing` for Lookup); authored definition payloads and YAML use lowercase. Formula/Lookup/Rollup definitions may be inherited from global or parent scopes using existing overlay layering.

## Lookup Semantics

- Scalar Relation input returns the related target value or `null`.
- List Relation input returns an ordered list of target values.
- Relation order and duplicate links are preserved.
- Target values are shape-preserving: strings, exact numbers, Booleans, lists, and JSON are not coerced.
- A missing relation is valid and produces `null` or `[]`, according to source cardinality.
- A broken relation, malformed relation member, or missing requested target field fails closed: stale materialized output is removed and a stable diagnostic is emitted.

## Rollup Semantics

- Related target values are normalized into the ordered reserved `values` array.
- Outgoing Rollup follows the local Relation field and derives its target scope from that Relation's target.
- Incoming Rollup searches `relation_scope` for documents whose `relation_field` points to the current document.
- The stored formula computes the final value and is checked against `result_type`.
- An empty valid relation set evaluates with `values = []`.
- Broken or malformed relations and missing requested target fields fail closed rather than silently undercounting.
- Materialized Formula values are valid target fields. Dependency ordering and cycle diagnostics are owned by the CLI module runner.

## Desktop Architecture

### Contracts and bridge

`src/renderer/types/cli.ts` owns the shared TypeScript contract. The preload exposes:

- `listModules(root)`
- `validateRollup(root, formula, resultType)`
- `saveLookupRollup(collectionId, scope, key, definition)`
- `removeLookupRollup(collectionId, scope, key)`

Module run parsing accepts the legacy single `ModuleReport` plus aggregate `reports` or `module_reports` envelopes. The renderer receives the `lookup_rollup` report while every returned module report is broadcast to watcher consumers.

### Capability detection

Lookup/Rollup authoring is enabled only when `mdvdb modules list` contains
`lookup_rollup`. The module descriptor is authoritative; app/CLI semver is not
used as a proxy for this capability.

Detection is fail-closed, cached and single-flight per active root. Rendering is never gated. Existing fields remain visible and read-only when the active CLI cannot author them.

### Definition transaction

Saving or removing a definition uses the Formula safety pattern:

1. Validate renderer and main-process inputs before disk mutation.
2. Validate Rollup syntax through `modules validate lookup_rollup`.
3. Resolve the effective inherited definition's origin.
4. Serialize schema mutations while the watcher is paused.
5. Snapshot the complete overlay.
6. Perform a comment-preserving atomic overlay update.
7. Run `modules run lookup_rollup`, scoped to the definition origin when possible.
8. Reject `module_error` diagnostics.
9. Broadcast module reports and refresh affected views.
10. On failure, restore the exact overlay snapshot and run an unscoped recompute to restore materialized values. Report both primary and rollback failures if restoration fails.

`.markdownvdb.schema.yml` continues to have exactly one app writer: `src/main/schema-overlay.ts`.

## Authoring UX

Lookup and Rollup appear in table Add Column and document Add Property only after capability detection succeeds. They never enter ordinary add-property or type-conversion operations.

A shared editor provides:

- an editable name while editing; renames carry both the original and requested key so the main
  process can perform one collision-checked overlay move instead of creating a second definition;
- outgoing Relation selector limited to Relation fields with a target folder;
- async target-schema field selector with loading, errors and stale-request protection;
- preservation and warning display for definitions whose selected field has drifted out of the current schema;
- Rollup outgoing/incoming direction;
- incoming collection-scope input and reverse Relation selector;
- Rollup result type, expression editor, validation and Sum/Count/Average/Minimum/Maximum presets;
- mutation hooks that flush an originating editor before module writes and reconcile it after completion;
- close protection while a mutation is active.

Unsupported clients hide creation actions and disable definition editing, while displaying the stored value and type normally.

## Read-only Rendering

Formula, Lookup and Rollup are one renderer category: computed fields.

- Table and document values are read-only.
- New-row seeding excludes all computed types.
- Every table edit path rejects all computed types.
- Raw frontmatter autocomplete excludes computed definitions.
- Formula and Rollup honor `result_type`; Lookup renders the materialized value's actual shape.
- Exact numeric tokens remain exact.
- Computed diagnostics take precedence over stale values.
- Type-specific markers distinguish Formula (`ƒx`), Lookup (`↗`) and Rollup (`Σ`).
- Tables filter, sort and group using materialized frontmatter, never `computed_fields` caches.

## Markdown Preservation

WYSIWYG frontmatter saves preserve every schema-declared Formula, Lookup and Rollup YAML pair byte-for-byte. This prevents the YAML library or JavaScript Number from rewriting high-precision totals, nested JSON, formatting, comments or list shape while an unrelated property changes.

The CLI module is the only writer of computed values. Renderer creation never inserts an empty raw key.

## Refresh and Watcher Behavior

Both `formula` and `lookup_rollup` are materializing modules. Watcher and synthetic module reports trigger a debounced reload of every open table because a target document can affect source documents in another folder. Document-origin mutations explicitly reread schema, document content and properties after the module finishes.

Ingest and watcher surfaces label the module as **Lookup & Rollup** and summarize its updated fields and diagnostics.

## Remove Versus Drop

Renaming a Lookup/Rollup resolves an inherited definition's true origin, rejects collisions before
publication, and moves the definition from the old key to the new key in the same comment-preserving
atomic overlay write used to apply any other edits. The dependency-aware module pipeline then removes
only the old module-owned materializations and writes the new key. A module-level failure CAS-restores
the prior overlay and recomputes the old definition; saved-view references are renamed only after the
materialization succeeds and remain auxiliary to the record-safe transaction.

The definition editor's Remove action removes the effective Lookup/Rollup definition from its origin scope and reruns the module. The existing property Drop flow remains vault-wide:

- exact previewed affected paths;
- stale-preview rejection;
- dirty-document blocking;
- every overlay definition removed;
- every materialized frontmatter key removed;
- saved views cleaned;
- one ingest to recompute remaining dependencies.

The UI must describe the scope distinction explicitly. Neither flow may overwrite a dirty editor without flushing it or blocking the operation.

## Diagnostics and Failure Policy

- Validation errors do not mutate the overlay or Markdown.
- Module errors roll back the definition and materialized values.
- Per-document failures remove stale output and remain visible as stable computed-field diagnostics.
- A diagnostic is rendered even when no materialized property exists, through a synthetic schema-backed row.
- `computed_fields` is non-authoritative and never displayed over frontmatter.

## Testing Requirements

Automated coverage includes:

- capability list present/absent/failure and single-flight behavior;
- overlay key serialization, outgoing omission, incoming requirements, comments, malformed files, inheritance and rollback snapshots;
- IPC arguments, validation-before-write, aggregate report normalization, module-error rollback and inherited removal;
- outgoing/incoming editor selection, target schema loading races, drifted selections, formulas and presets;
- create/edit gating without render gating;
- read-only table/document behavior, exact values, diagnostics and frontmatter-over-cache precedence;
- computed-field exclusion from row seeding and raw property autocomplete;
- byte-exact WYSIWYG preservation for Lookup/Rollup values;
- table refresh from `lookup_rollup` reports;
- vault-wide Drop safety; and
- end-to-end target propagation and invoice aggregation.

## Non-Goals

- Arbitrary multi-hop path expressions.
- Incoming Lookup.
- Editable computed values.
- Renderer-side relation resolution or aggregation.
- Silent numeric coercion or skipping invalid financial records.
- Type conversion into or out of computed fields.
- Version or index-format bumps.
