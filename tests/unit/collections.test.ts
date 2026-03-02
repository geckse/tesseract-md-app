import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node:fs
const mockExistsSync = vi.fn()
const mockStatSync = vi.fn()
vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args)
}))

// Mock electron dialog
const mockShowOpenDialog = vi.fn()
const mockShowMessageBox = vi.fn()
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args),
    showMessageBox: (...args: unknown[]) => mockShowMessageBox(...args)
  }
}))

// Mock CLI module
const mockExecRaw = vi.fn()
vi.mock('../../src/main/cli', () => ({
  execRaw: (...args: unknown[]) => mockExecRaw(...args)
}))

import {
  validateCollectionPath,
  pickCollectionFolder,
  initCollection,
  confirmRemoveCollection,
  promptInitCollection
} from '../../src/main/collections'

beforeEach(() => {
  mockExistsSync.mockReset()
  mockStatSync.mockReset()
  mockShowOpenDialog.mockReset()
  mockShowMessageBox.mockReset()
  mockExecRaw.mockReset()
})

describe('validateCollectionPath', () => {
  it('returns error for empty path', async () => {
    const result = await validateCollectionPath('')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Path is empty')
  })

  it('returns error when path does not exist', async () => {
    mockExistsSync.mockReturnValue(false)

    const result = await validateCollectionPath('/tmp/nonexistent')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Path does not exist')
    expect(result.name).toBe('nonexistent')
  })

  it('returns error when path is not a directory', async () => {
    mockExistsSync.mockReturnValue(true)
    mockStatSync.mockReturnValue({ isDirectory: () => false })

    const result = await validateCollectionPath('/tmp/file.txt')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Path is not a directory')
  })

  it('returns error when stat throws', async () => {
    mockExistsSync.mockReturnValue(true)
    mockStatSync.mockImplementation(() => { throw new Error('permission denied') })

    const result = await validateCollectionPath('/tmp/noaccess')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Cannot access path')
  })

  it('returns valid with hasConfig true when .markdownvdb exists', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/tmp/project') return true
      if (p === '/tmp/project/.markdownvdb') return true
      return false
    })
    mockStatSync.mockReturnValue({ isDirectory: () => true })

    const result = await validateCollectionPath('/tmp/project')
    expect(result.valid).toBe(true)
    expect(result.hasConfig).toBe(true)
    expect(result.name).toBe('project')
  })

  it('returns valid with hasConfig false when no config', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/tmp/project') return true
      return false
    })
    mockStatSync.mockReturnValue({ isDirectory: () => true })

    const result = await validateCollectionPath('/tmp/project')
    expect(result.valid).toBe(true)
    expect(result.hasConfig).toBe(false)
  })

  it('detects .markdownvdb/.config as hasConfig', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/tmp/project') return true
      if (p === '/tmp/project/.markdownvdb') return false
      if (p === '/tmp/project/.markdownvdb/.config') return true
      return false
    })
    mockStatSync.mockReturnValue({ isDirectory: () => true })

    const result = await validateCollectionPath('/tmp/project')
    expect(result.valid).toBe(true)
    expect(result.hasConfig).toBe(true)
  })
})

describe('pickCollectionFolder', () => {
  it('returns selected folder path', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/selected'] })

    const result = await pickCollectionFolder()
    expect(result).toBe('/tmp/selected')
    expect(mockShowOpenDialog).toHaveBeenCalledWith({
      title: 'Select Markdown Collection Folder',
      properties: ['openDirectory']
    })
  })

  it('returns null when dialog is canceled', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await pickCollectionFolder()
    expect(result).toBeNull()
  })

  it('returns null when no files selected', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })

    const result = await pickCollectionFolder()
    expect(result).toBeNull()
  })
})

describe('initCollection', () => {
  it('calls execRaw with init command', async () => {
    mockExecRaw.mockResolvedValue('')

    await initCollection('/tmp/project')
    expect(mockExecRaw).toHaveBeenCalledWith('init', [], '/tmp/project')
  })
})

describe('confirmRemoveCollection', () => {
  it('returns true when user confirms', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 1 })

    const result = await confirmRemoveCollection('my-project')
    expect(result).toBe(true)
    expect(mockShowMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'question',
        buttons: ['Cancel', 'Remove'],
        message: 'Remove "my-project" from your collections?'
      })
    )
  })

  it('returns false when user cancels', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 })

    const result = await confirmRemoveCollection('my-project')
    expect(result).toBe(false)
  })
})

describe('promptInitCollection', () => {
  it('returns true when user confirms initialization', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 1 })

    const result = await promptInitCollection('my-project')
    expect(result).toBe(true)
    expect(mockShowMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'question',
        buttons: ['Cancel', 'Initialize'],
        message: '"my-project" is not yet initialized as a Markdown VDB collection.'
      })
    )
  })

  it('returns false when user cancels', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 })

    const result = await promptInitCollection('my-project')
    expect(result).toBe(false)
  })
})
