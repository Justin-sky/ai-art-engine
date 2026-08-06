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

  it('prefers text output node over upstream screenplay generatedTexts', () => {
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
              generatedTexts: [{ id: 't1', text: 'from gen' }]
            }
          },
          {
            id: 'text-output',
            typeId: 'output.text',
            category: 'output',
            position: { x: 200, y: 0 },
            params: { outputKind: 'text', resultText: 'from output' }
          }
        ],
        edges: [{ id: 'e1', source: 'sp', target: 'text-output', sourcePort: 'out', targetPort: 'in' }]
      }
    })
    expect(text).toBe('from output')
  })

  it('collectScreenplayTextRelativePaths prefers text output paths', () => {
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
            generatedTexts: [{ id: 't1', text: '', relativePath: 'Texts/from-gen.txt' }]
          }
        },
        {
          id: 'text-output',
          typeId: 'output.text',
          category: 'output',
          position: { x: 200, y: 0 },
          params: { outputKind: 'text' }
        }
      ],
      edges: [{ id: 'e1', source: 'sp', target: 'text-output', sourcePort: 'out', targetPort: 'in' }],
      runStates: {
        'text-output': {
          status: 'done',
          outputs: {
            out: {
              kind: 'texts',
              items: [{ id: 't-out', text: '', relativePath: 'Texts/from-output.txt' }]
            }
          }
        }
      }
    })
    expect(paths).toEqual(['Texts/from-output.txt'])
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

})
