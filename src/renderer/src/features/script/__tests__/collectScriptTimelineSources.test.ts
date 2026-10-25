import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flattenVideosValues, type GraphDocument } from '@shared/graph'
import { useProjectStore } from '../../../stores/project'
import { graphEditorHosts } from '../../graph/model/graphEditorHosts'
import { collectScriptTimelineSources } from '../collectScriptTimelineSources'

describe('collectScriptTimelineSources', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('collects videos and voices connected to output.timeline input ports even when output.video exists', async () => {
    const project = useProjectStore()
    const doc: GraphDocument = {
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'vid-unconnected',
          typeId: 'asset.video',
          category: 'asset',
          assetType: 'video',
          title: 'Unconnected Shot',
          position: { x: 0, y: 0 },
          params: {
            previewRelativePath: 'Assets/Videos/unconnected.mp4'
          }
        },
        {
          id: 'vid-1',
          typeId: 'asset.video',
          category: 'asset',
          assetType: 'video',
          title: 'Hero Shot',
          position: { x: 0, y: 100 },
          params: {
            generatedVideos: [
              { id: 'v1', relativePath: 'Assets/Videos/shot1-a.mp4' },
              { id: 'v2', relativePath: 'Assets/Videos/shot1-b.mp4' }
            ],
            selectedVideoId: 'v2'
          }
        },
        {
          id: 'vid-gallery',
          typeId: 'asset.video',
          category: 'asset',
          assetType: 'video',
          title: 'Montage',
          position: { x: 0, y: 200 },
          params: {
            generatedVideos: [
              { id: 'm1', relativePath: 'Assets/Videos/montage-1.mp4' },
              { id: 'm2', relativePath: 'Assets/Videos/montage-2.mp4' }
            ]
          }
        },
        {
          id: 'voice-1',
          typeId: 'asset.voice',
          category: 'asset',
          assetType: 'voice',
          title: 'Narrator',
          position: { x: 0, y: 300 },
          params: {
            generatedVoices: [{ id: 'vo1', relativePath: 'Assets/Voices/line1.mp3' }]
          }
        },
        {
          id: 'output-video',
          typeId: 'output.video',
          category: 'output',
          title: 'Video Output',
          position: { x: 400, y: 0 },
          params: {}
        },
        {
          id: 'timeline-1',
          typeId: 'output.timeline',
          category: 'output',
          title: 'Final Timeline',
          position: { x: 400, y: 200 },
          params: {
            previewRelativePath: 'Cache/TimelineCompose/composed.mp4',
            generatedVideos: [
              { id: 'timeline-composed', relativePath: 'Cache/TimelineCompose/composed.mp4' }
            ]
          }
        }
      ],
      edges: [
        {
          id: 'e0',
          source: 'vid-unconnected',
          sourcePort: 'out',
          target: 'output-video',
          targetPort: 'in'
        },
        {
          id: 'e1',
          source: 'vid-1',
          sourcePort: 'out',
          target: 'timeline-1',
          targetPort: 'in'
        },
        {
          id: 'e2',
          source: 'vid-gallery',
          sourcePort: 'out-all',
          target: 'timeline-1',
          targetPort: 'in-videos'
        },
        {
          id: 'e3',
          source: 'voice-1',
          sourcePort: 'out',
          target: 'timeline-1',
          targetPort: 'in-voice'
        }
      ]
    }

    project.assets = [
      {
        id: 'root-script',
        name: 'Root Script',
        type: 'script',
        createdAt: 1,
        updatedAt: 1,
        genParams: { graphJson: doc }
      } as never
    ]

    const sources = await collectScriptTimelineSources({
      scriptAssetId: 'root-script',
      timelineNodeId: 'timeline-1'
    })

    expect(
      sources.map((s) => ({ rel: s.relativePath, kind: s.mediaKind, nodeId: s.nodeId }))
    ).toEqual([
      { rel: 'Assets/Videos/shot1-b.mp4', kind: 'video', nodeId: 'vid-1' },
      { rel: 'Assets/Videos/montage-1.mp4', kind: 'video', nodeId: 'vid-gallery' },
      { rel: 'Assets/Videos/montage-2.mp4', kind: 'video', nodeId: 'vid-gallery' },
      { rel: 'Assets/Voices/line1.mp3', kind: 'voice', nodeId: 'voice-1' }
    ])
  })

  it('resolves unrun asset reference nodes, framePull nodes, bundles, and live host documents', async () => {
    const project = useProjectStore()
    project.assets = [
      {
        id: 'root-script',
        name: 'Root Script',
        type: 'script',
        createdAt: 1,
        updatedAt: 1,
        genParams: {}
      } as never,
      {
        id: 'asset-vid-ref',
        name: 'Library Clip',
        type: 'video',
        relativePath: 'Assets/Videos/library-clip.mp4',
        createdAt: 1,
        updatedAt: 1
      } as never,
      {
        id: 'asset-voice-ref',
        name: 'Library Voice',
        type: 'voice',
        relativePath: 'Assets/Voices/library-voice.mp3',
        createdAt: 1,
        updatedAt: 1
      } as never
    ]

    const liveDoc: GraphDocument = {
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'ref-vid-node',
          typeId: 'asset.video',
          category: 'asset',
          assetType: 'video',
          assetId: 'asset-vid-ref',
          title: 'Ref Video',
          position: { x: 0, y: 0 },
          params: { assetRef: true }
        },
        {
          id: 'frame-pull-node',
          typeId: 'video.framePull',
          category: 'asset',
          title: 'Frame Pull',
          position: { x: 150, y: 0 },
          params: {}
        },
        {
          id: 'bundle-node',
          typeId: 'media.bundle',
          category: 'asset',
          title: 'Bundle',
          position: { x: 250, y: 0 },
          params: { bundleDataType: 'video' }
        },
        {
          id: 'ref-voice-node',
          typeId: 'asset.voice',
          category: 'asset',
          assetType: 'voice',
          assetId: 'asset-voice-ref',
          title: 'Ref Voice',
          position: { x: 0, y: 120 },
          params: { assetRef: true }
        },
        {
          id: 'timeline-live',
          typeId: 'output.timeline',
          category: 'output',
          title: 'Timeline',
          position: { x: 400, y: 60 },
          params: {}
        }
      ],
      edges: [
        {
          id: 'e-fp-in',
          source: 'ref-vid-node',
          sourcePort: 'out',
          target: 'frame-pull-node',
          targetPort: 'in'
        },
        {
          id: 'e-bundle-in',
          source: 'frame-pull-node',
          sourcePort: 'out',
          target: 'bundle-node',
          targetPort: 'in'
        },
        {
          id: 'e-tl-vid',
          source: 'bundle-node',
          sourcePort: 'out',
          target: 'timeline-live',
          targetPort: 'in'
        },
        {
          id: 'e-tl-voice',
          source: 'ref-voice-node',
          sourcePort: 'out',
          target: 'timeline-live',
          targetPort: 'in-voice'
        }
      ]
    }

    const unregister = graphEditorHosts.register('asset:root-script', {
      flush: async () => {},
      getNode: (id) => liveDoc.nodes.find((n) => n.id === id) ?? null,
      getDocument: () => liveDoc,
      updateNode: () => {},
      setNodeAsset: () => {}
    })

    const sources = await collectScriptTimelineSources({
      scriptAssetId: 'root-script',
      hostId: 'asset:root-script',
      timelineNodeId: 'timeline-live'
    })
    unregister()

    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({
      relativePath: 'Assets/Videos/library-clip.mp4',
      assetId: 'asset-vid-ref',
      mediaKind: 'video',
      origin: 'input',
      nodeId: 'frame-pull-node'
    })
    expect(sources[1]).toMatchObject({
      relativePath: 'Assets/Voices/library-voice.mp3',
      assetId: 'asset-voice-ref',
      mediaKind: 'voice',
      origin: 'input',
      nodeId: 'ref-voice-node'
    })
  })

  it('flattens single asset video values in flattenVideosValues', () => {
    const items = flattenVideosValues([
      {
        kind: 'asset',
        assetType: 'video',
        assetId: 'vid-asset-1',
        relativePath: 'Assets/Videos/a.mp4'
      },
      {
        kind: 'videos',
        items: [{ id: 'vid-2', relativePath: 'Assets/Videos/b.mp4' }]
      }
    ])
    expect(items).toEqual([
      { id: 'vid-asset-1', relativePath: 'Assets/Videos/a.mp4' },
      { id: 'vid-2', relativePath: 'Assets/Videos/b.mp4' }
    ])
  })

  it('resolves upstream source video through unrun semantic.rebuild and processing asset.video chains', async () => {
    const project = useProjectStore()
    const doc: GraphDocument = {
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'src-video',
          typeId: 'asset.video',
          category: 'asset',
          assetType: 'video',
          title: 'Source Video',
          position: { x: 0, y: 0 },
          params: {
            previewRelativePath: 'Cache/imports/source_clip.mp4'
          }
        },
        {
          id: 'sem-analyze',
          typeId: 'semantic.analyze',
          category: 'note',
          title: 'Analyze',
          position: { x: 100, y: 0 },
          params: {}
        },
        {
          id: 'sem-compile',
          typeId: 'semantic.compile',
          category: 'note',
          title: 'Compile',
          position: { x: 200, y: 0 },
          params: {}
        },
        {
          id: 'sem-rebuild',
          typeId: 'semantic.rebuild',
          category: 'note',
          title: 'Rebuild',
          position: { x: 300, y: 0 },
          params: {}
        },
        {
          id: 'timeline-sem',
          typeId: 'output.timeline',
          category: 'output',
          title: 'Timeline',
          position: { x: 450, y: 0 },
          params: {}
        }
      ],
      edges: [
        {
          id: 'e1',
          source: 'src-video',
          sourcePort: 'out',
          target: 'sem-analyze',
          targetPort: 'in-video'
        },
        {
          id: 'e2',
          source: 'sem-analyze',
          sourcePort: 'out',
          target: 'sem-compile',
          targetPort: 'in'
        },
        {
          id: 'e3',
          source: 'sem-compile',
          sourcePort: 'out',
          target: 'sem-rebuild',
          targetPort: 'in'
        },
        {
          id: 'e4',
          source: 'sem-rebuild',
          sourcePort: 'out-video',
          target: 'timeline-sem',
          targetPort: 'in-videos'
        }
      ]
    }

    project.assets = [
      {
        id: 'canvas-sem',
        name: 'Canvas Semantic',
        type: 'canvas',
        createdAt: 1,
        updatedAt: 1,
        genParams: { graphJson: doc }
      } as never
    ]

    // 1) Before semantic.rebuild runs, it walks upstream to src-video
    const beforeRun = await collectScriptTimelineSources({
      scriptAssetId: 'canvas-sem',
      timelineNodeId: 'timeline-sem'
    })
    expect(beforeRun).toHaveLength(1)
    expect(beforeRun[0]).toMatchObject({
      relativePath: 'Cache/imports/source_clip.mp4',
      mediaKind: 'video',
      origin: 'input',
      nodeId: 'sem-rebuild'
    })

    // 2) After semantic.rebuild runs and produces rebuildLastOutput + variants, it resolves those
    doc.nodes.find((n) => n.id === 'sem-rebuild')!.params = {
      rebuildLastOutput: 'Semantic/tl-1/rebuild.mp4',
      previewRelativePath: 'Semantic/tl-1/rebuild.mp4',
      rebuildLastReport: JSON.stringify({
        rebuild: { outputRelativePath: 'Semantic/tl-1/rebuild.mp4' },
        variants: [{ id: 'v1', outputRelativePath: 'Semantic/tl-1/rebuild-v1.mp4' }]
      })
    }
    const afterRun = await collectScriptTimelineSources({
      scriptAssetId: 'canvas-sem',
      timelineNodeId: 'timeline-sem'
    })
    expect(afterRun.map((s) => s.relativePath)).toEqual([
      'Semantic/tl-1/rebuild.mp4',
      'Semantic/tl-1/rebuild-v1.mp4'
    ])
  })
})
