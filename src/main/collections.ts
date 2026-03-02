/**
 * Collection path validation, folder picker, and initialization helpers.
 *
 * Provides filesystem validation for collection paths, native folder picker
 * dialogs, and CLI-based collection initialization via `mdvdb init`.
 */

import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { dialog } from 'electron'

import { execRaw } from './cli'

/** Result of validating a collection path */
export interface ValidationResult {
  valid: boolean
  hasConfig: boolean
  name: string
  error?: string
}

/**
 * Validate that a path is suitable for use as a collection.
 *
 * Checks that the path exists, is a directory, and optionally detects
 * whether it already has a `.markdownvdb` config directory or file.
 */
export async function validateCollectionPath(path: string): Promise<ValidationResult> {
  const name = basename(path) || path

  if (!path) {
    return { valid: false, hasConfig: false, name: '', error: 'Path is empty' }
  }

  if (!existsSync(path)) {
    return { valid: false, hasConfig: false, name, error: 'Path does not exist' }
  }

  try {
    const stat = statSync(path)
    if (!stat.isDirectory()) {
      return { valid: false, hasConfig: false, name, error: 'Path is not a directory' }
    }
  } catch {
    return { valid: false, hasConfig: false, name, error: 'Cannot access path' }
  }

  // Check for existing .markdownvdb config (directory or legacy file)
  const hasConfig =
    existsSync(`${path}/.markdownvdb`) ||
    existsSync(`${path}/.markdownvdb/.config`)

  return { valid: true, hasConfig, name }
}

/**
 * Show a native folder picker dialog.
 * Returns the selected folder path, or null if canceled.
 */
export async function pickCollectionFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select Markdown Collection Folder',
    properties: ['openDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
}

/**
 * Initialize a collection folder by running `mdvdb init`.
 * Creates the `.markdownvdb` config directory in the target path.
 */
export async function initCollection(path: string): Promise<void> {
  await execRaw('init', [], path)
}

/**
 * Show a confirmation dialog before removing a collection.
 * Returns true if the user confirmed removal.
 */
export async function confirmRemoveCollection(name: string): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Remove'],
    defaultId: 0,
    cancelId: 0,
    title: 'Remove Collection',
    message: `Remove "${name}" from your collections?`,
    detail: 'This will not delete any files on disk. The collection can be re-added later.'
  })

  return result.response === 1
}

/**
 * Prompt the user to initialize an uninitialized folder as a collection.
 * Returns true if the user wants to initialize.
 */
export async function promptInitCollection(name: string): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Initialize'],
    defaultId: 1,
    cancelId: 0,
    title: 'Initialize Collection',
    message: `"${name}" is not yet initialized as a Markdown VDB collection.`,
    detail: 'Would you like to initialize it? This will create a .markdownvdb configuration directory.'
  })

  return result.response === 1
}
