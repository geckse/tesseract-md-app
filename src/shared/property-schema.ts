import type { PropertyTargetType } from '../preload/api'

/** Canonical schema-overlay `field_type` for every addable UI property type. */
export function overlayFieldTypeForPropertyTarget(target: PropertyTargetType): string {
  switch (target) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'date':
    case 'datetime':
      return 'date'
    case 'tags':
      return 'list'
    case 'relation':
      return 'relation'
    case 'file':
      return 'file'
    case 'complex':
      return 'mixed'
    case 'text':
    case 'url':
    case 'email':
    case 'select':
      return 'string'
  }
}
