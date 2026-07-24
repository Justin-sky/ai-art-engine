import { describe, expect, it } from 'vitest'
import {
  collectScreenplayTextRelativePaths,
  executeTextAssetRefNode,
  resolveAssetTextFromGenParams,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('text asset ref (screenplay / script)', () => {
  it('resolveAssetTextFromGenParams reads text from graphJson (script / non-file)', () => {
    const text = resolveAssetTextFromGenParams({
      graphJson: {
        version: 1,
        nodes: [
          {
            id: 'sp',
            typeId: 'asset.screenplay',
            category: 'asset',
            assetType: 'screenplay',
            position: { x: 0, y: 0 },
            params: { text: 'INT. ROOM - DAY\nHello.' }
          }
        ],
        edges: []
      }
    })
    expect(text).toBe('INT. ROOM - DAY\nHello.')
  })

  it('collectScreenplayTextRelativePaths reads generatedTexts paths', () => {
    const paths = collectScreenplayTextRelativePaths({
      version: 1,
      nodes: [
        {
          id: 'sp',
          typeId: 'asset.screenplay',
          category: 'asset',
          assetType: 'screenplay',
          position: { x: 0, y: 0 },
          params: {
            text: '',
            generatedTexts: [{ id: 't1', text: '', relativePath: 'Texts/foo.txt' }]
          }
        }
      ],
      edges: []
    })
    expect(paths).toEqual(['Texts/foo.txt'])
  })

  it('resolveAssetTextFromGenParams reads generatedTexts inline text', () => {
    const text = resolveAssetTextFromGenParams({
      graphJson: {
        version: 1,
        nodes: [
          {
            id: 'sp',
            typeId: 'asset.screenplay',
            category: 'asset',
            assetType: 'screenplay',
            position: { x: 0, y: 0 },
            params: {
              text: '',
              generatedTexts: [{ id: 't1', text: '仅在 generatedTexts' }]
            }
          }
        ],
        edges: []
      }
    })
    expect(text).toBe('仅在 generatedTexts')
  })

  it('executeTextAssetRefNode loads screenplay via resolveAssetText only', async () => {
    const ctx: NodeExecuteContext = {
      node: {
        id: 'ref-1',
        typeId: 'asset.screenplay',
        category: 'asset',
        assetId: 'sp-1',
        assetType: 'screenplay',
        position: { x: 0, y: 0 },
        params: { assetRef: true }
      },
      inputs: {},
      resolveAssetText: async (assetId) =>
        assetId === 'sp-1' ? 'From file via URL' : undefined,
      resolveAssetGenParams: () => ({
        graphJson: {
          version: 1,
          nodes: [
            {
              id: 'sp',
              typeId: 'asset.screenplay',
              category: 'asset',
              assetType: 'screenplay',
              position: { x: 0, y: 0 },
              params: { text: 'Should not use graphJson' }
            }
          ],
          edges: []
        }
      })
    }
    const result = await executeTextAssetRefNode(ctx)
    expect(result.out).toEqual({ kind: 'text', text: 'From file via URL' })
  })

  it('executeTextAssetRefNode screenplay falls back to genParams when no file resolver', async () => {
    const ctx: NodeExecuteContext = {
      node: {
        id: 'ref-1',
        typeId: 'asset.screenplay',
        category: 'asset',
        assetId: 'sp-1',
        assetType: 'screenplay',
        position: { x: 0, y: 0 },
        params: { assetRef: true }
      },
      inputs: {},
      resolveAssetGenParams: () => ({
        graphJson: {
          version: 1,
          nodes: [
            {
              id: 'sp',
              typeId: 'asset.screenplay',
              category: 'asset',
              assetType: 'screenplay',
              position: { x: 0, y: 0 },
              params: { text: 'from graph' }
            }
          ],
          edges: []
        }
      })
    }
    const result = await executeTextAssetRefNode(ctx)
    expect(result.out).toEqual({ kind: 'text', text: 'from graph' })
  })

  it('script asset ref still reads genParams text', async () => {
    const ctx: NodeExecuteContext = {
      node: {
        id: 'ref-2',
        typeId: 'asset.script',
        category: 'asset',
        assetId: 'script-1',
        assetType: 'script',
        position: { x: 0, y: 0 },
        params: { assetRef: true }
      },
      inputs: {},
      resolveAssetGenParams: () => ({
        graphJson: {
          version: 1,
          nodes: [
            {
              id: 'note',
              typeId: 'play.script',
              category: 'note',
              position: { x: 0, y: 0 },
              params: { text: 'Shot note' }
            }
          ],
          edges: []
        }
      })
    }
    const result = await executeTextAssetRefNode(ctx)
    expect(result.out).toEqual({ kind: 'text', text: 'Shot note' })
  })
})
