import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flattenVideosValues, type GraphDocument } from '@shared/graph'
import { useProjectStore } from '../../../stores/project'
import { graphEditorHosts } from '../../graph/model/graphEditorHosts'
import { autoArrangeTimelineFromGraphHost } from '../../graph/model/composeTimelineVideo'
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
          targetPort: 'in'
        },
        {
          id: 'e2',
          source: 'sem-analyze',
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

  it('collects and auto-arranges 6-act ancient scroll revival (Act 1..Act 6) across all timeline tracks on dive without FFmpeg export', async () => {
    const project = useProjectStore()
    const nodes: GraphDocument['nodes'] = [
      {
        id: 'scroll-src',
        typeId: 'asset.image',
        category: 'asset',
        assetType: 'image',
        title: '汉宫春晓图 · 原画全卷', // cjk-ok
        position: { x: 0, y: 0 },
        params: {
          sourceRelativePath: '@Assets/hangong-scroll.jpg'
        }
      },
      {
        id: 'bgm',
        typeId: 'asset.music',
        category: 'asset',
        assetType: 'voice',
        title: '宫廷古琴雅乐', // cjk-ok
        position: { x: 0, y: 600 },
        params: {
          sourceRelativePath: '@Assets/Audio/palace-bgm.mp3'
        }
      },
      {
        id: 'timeline-out',
        typeId: 'output.timeline',
        category: 'output',
        title: '汉宫春晓图·六幕一镜入画成片', // cjk-ok
        position: { x: 1200, y: 300 },
        params: {}
      }
    ]
    const edges: GraphDocument['edges'] = []

    for (let act = 1; act <= 6; act++) {
      nodes.push(
        {
          id: `act${act}-crop`,
          typeId: 'image.process',
          category: 'note',
          assetType: 'image',
          title: `第${act}幕·古画取景`, // cjk-ok
          position: { x: 300, y: act * 120 },
          params: {
            imageProcessTool: 'crop',
            imageCrop: { cropX: (act - 1) * 0.15, cropY: 0.1, cropW: 0.25, cropH: 0.8 },
            previewRelativePath: `Cache/Images/act${act}-crop.png`
          }
        },
        {
          id: `act${act}-recognize`,
          typeId: 'image.toPrompt',
          category: 'note',
          title: `第${act}幕·识图考据`, // cjk-ok
          position: { x: 500, y: act * 120 },
          params: {
            text: `晨光熹微，第${act}幕宫苑仕女执扇轻语。仕女甲：「今日春光正好。」` // cjk-ok
          }
        },
        {
          id: `act${act}-real`,
          typeId: 'asset.image',
          category: 'asset',
          assetType: 'image',
          title: `第${act}幕·实景还原`, // cjk-ok
          position: { x: 700, y: act * 120 },
          params: {
            previewRelativePath: `Cache/Images/act${act}-real.png`
          }
        },
        {
          id: `act${act}-video`,
          typeId: 'asset.video',
          category: 'asset',
          assetType: 'video',
          title: `第${act}幕·一镜入画`, // cjk-ok
          position: { x: 900, y: act * 120 },
          params: {
            previewRelativePath: `Cache/Videos/act${act}-shot.mp4`
          }
        },
        {
          id: `act${act}-voice`,
          typeId: 'asset.voice',
          category: 'asset',
          assetType: 'voice',
          title: `第${act}幕解说`, // cjk-ok
          position: { x: 900, y: 800 + act * 80 },
          params: {
            generateInstruction: `第${act}幕文博解说词，细腻呈现宫廷春晓盛景。`, // cjk-ok
            previewRelativePath: `Cache/Voices/act${act}-voice.mp3`
          }
        },
        {
          id: `act${act}-sfx`,
          typeId: 'asset.sfx',
          category: 'asset',
          assetType: 'voice',
          title: `第${act}幕环境音`, // cjk-ok
          position: { x: 900, y: 1400 + act * 80 },
          params: {
            previewRelativePath: `Cache/Sfx/act${act}-sfx.mp3`
          }
        }
      )

      // Intentionally wire video BEFORE crop (reverse order across acts too) to test robust 第N幕 sorting
      edges.push(
        {
          id: `e-src-crop-${act}`,
          source: 'scroll-src',
          sourcePort: 'out',
          target: `act${act}-crop`,
          targetPort: 'in'
        },
        {
          id: `e-crop-real-${act}`,
          source: `act${act}-crop`,
          sourcePort: 'out',
          target: `act${act}-real`,
          targetPort: 'in-image'
        },
        {
          id: `e-real-vid-${act}`,
          source: `act${act}-real`,
          sourcePort: 'out',
          target: `act${act}-video`,
          targetPort: 'in-first-frame'
        },
        {
          id: `e-vid-tl-${act}`,
          source: `act${act}-video`,
          sourcePort: 'out',
          target: 'timeline-out',
          targetPort: 'in'
        },
        {
          id: `e-crop-tl-${act}`,
          source: `act${act}-crop`,
          sourcePort: 'out',
          target: 'timeline-out',
          targetPort: 'in-image'
        },
        {
          id: `e-sfx-tl-${act}`,
          source: `act${act}-sfx`,
          sourcePort: 'out',
          target: 'timeline-out',
          targetPort: 'in-voice'
        },
        {
          id: `e-voice-tl-${act}`,
          source: `act${act}-voice`,
          sourcePort: 'out',
          target: 'timeline-out',
          targetPort: 'in-voice'
        }
      )
    }
    edges.push({
      id: 'e-bgm-tl',
      source: 'bgm',
      sourcePort: 'out',
      target: 'timeline-out',
      targetPort: 'in-music'
    })

    const doc: GraphDocument = {
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes,
      edges
    }

    project.assets = [
      {
        id: 'canvas-hangong',
        name: '汉宫春晓图画布', // cjk-ok
        type: 'canvas',
        createdAt: 1,
        updatedAt: 1,
        genParams: { graphJson: doc }
      } as never
    ]

    const collected = await collectScriptTimelineSources({
      scriptAssetId: 'canvas-hangong',
      timelineNodeId: 'timeline-out'
    })

    const visualPaths = collected.filter((s) => s.mediaKind === 'video').map((s) => s.relativePath)
    // Expect 6 acts * (crop + real + video) = 18 visual sources in exact Act 1..6 order
    expect(visualPaths).toEqual([
      'Cache/Images/act1-crop.png',
      'Cache/Images/act1-real.png',
      'Cache/Videos/act1-shot.mp4',
      'Cache/Images/act2-crop.png',
      'Cache/Images/act2-real.png',
      'Cache/Videos/act2-shot.mp4',
      'Cache/Images/act3-crop.png',
      'Cache/Images/act3-real.png',
      'Cache/Videos/act3-shot.mp4',
      'Cache/Images/act4-crop.png',
      'Cache/Images/act4-real.png',
      'Cache/Videos/act4-shot.mp4',
      'Cache/Images/act5-crop.png',
      'Cache/Images/act5-real.png',
      'Cache/Videos/act5-shot.mp4',
      'Cache/Images/act6-crop.png',
      'Cache/Images/act6-real.png',
      'Cache/Videos/act6-shot.mp4'
    ])

    const bgmSrc = collected.find((s) => s.nodeId === 'bgm')
    expect(bgmSrc).toMatchObject({
      relativePath: 'Assets/Audio/palace-bgm.mp3',
      mediaKind: 'voice',
      trackHint: 'music'
    })
    expect(collected.filter((s) => s.trackHint === 'sfx')).toHaveLength(6)
    expect(collected.filter((s) => s.trackHint === 'voice')).toHaveLength(6)

    // Simulate diving into timeline-out (even if an early placeholder auto clip existed before acts finished)
    const arranged = await autoArrangeTimelineFromGraphHost({
      scriptAssetId: 'canvas-hangong',
      timelineNodeId: 'timeline-out',
      baseDoc: {
        clips: [
          {
            id: 'clip:auto:v:0:early',
            track: 'video',
            sourceId: 'Assets/hangong-scroll.jpg',
            title: 'Placeholder',
            relativePath: 'Assets/hangong-scroll.jpg',
            startSec: 0,
            durationSec: 4
          }
        ]
      },
      collectedSources: collected,
      persist: false
    })

    expect(arranged?.dirty).toBe(true)
    const clips = arranged!.doc.clips
    // All 6 tracks (video, overlay, subtitle, voice, sfx, music) must be populated!
    expect(
      clips.filter((c) => c.track === 'video' && c.id.startsWith('clip:auto:pre:'))
    ).toHaveLength(6)
    expect(
      clips.filter((c) => c.track === 'video' && c.id.startsWith('clip:auto:real:'))
    ).toHaveLength(6)
    expect(
      clips.filter((c) => c.track === 'video' && c.id.startsWith('clip:auto:v:'))
    ).toHaveLength(6)
    expect(
      clips.filter((c) => c.track === 'overlay' && c.id.startsWith('clip:auto:vf:'))
    ).toHaveLength(6)
    expect(clips.filter((c) => c.track === 'voice')).toHaveLength(6)
    expect(clips.filter((c) => c.track === 'sfx').length).toBeGreaterThanOrEqual(6)
    expect(clips.filter((c) => c.track === 'subtitle').length).toBeGreaterThanOrEqual(12)
    expect(clips.filter((c) => c.track === 'music')).toHaveLength(1)
    expect(arranged!.doc.settings?.scaleMode).toBe('cover')
    expect(arranged!.doc.settings?.mixAutoDucking).toBe(true)
  })
})
