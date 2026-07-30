import { describe, expect, it } from 'vitest'
import {
  entityImageUrlsByShotId,
  resolveShotEntityImageUrlsFromGraphs,
  type GraphDocument
} from '../src/shared/graph'

describe('resolveShotEntityImageUrlsFromGraphs', () => {
  const shotId = 'shot-1'

  function docWith(nodes: GraphDocument['nodes']): GraphDocument {
    return { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
  }

  it('prefers script.shotImageGen over stale script.shotVideoGen cache', () => {
    const urls = resolveShotEntityImageUrlsFromGraphs(
      [
        docWith([
          {
            id: 'video-gen',
            typeId: 'script.shotVideoGen',
            category: 'note',
            position: { x: 0, y: 0 },
            params: {
              shotEntities: [
                {
                  id: shotId,
                  name: '镜1',
                  imageUrls: ['Cache/Images/old-scene.jpg']
                }
              ]
            }
          },
          {
            id: 'image-gen',
            typeId: 'script.shotImageGen',
            category: 'note',
            position: { x: 200, y: 0 },
            params: {
              shotEntities: [
                {
                  id: shotId,
                  name: '镜1',
                  imageUrls: ['Cache/Images/new-scene.jpg']
                }
              ]
            }
          }
        ])
      ],
      shotId
    )
    expect(urls).toEqual(['Cache/Images/new-scene.jpg'])
  })

  it('falls back to shotVideoGen when image gen has no match', () => {
    const urls = resolveShotEntityImageUrlsFromGraphs(
      [
        docWith([
          {
            id: 'video-gen',
            typeId: 'script.shotVideoGen',
            category: 'note',
            position: { x: 0, y: 0 },
            params: {
              shotEntities: [
                {
                  id: shotId,
                  name: '镜1',
                  imageUrls: ['Cache/Images/from-video-cache.jpg']
                }
              ]
            }
          }
        ])
      ],
      shotId
    )
    expect(urls).toEqual(['Cache/Images/from-video-cache.jpg'])
  })

  it('maps live entities by shot id', () => {
    expect(
      entityImageUrlsByShotId([
        { id: 'a', name: 'A', imageUrls: ['Cache/a.png'] },
        { id: 'b', name: 'B', imageUrls: ['Cache/b.png', 'Cache/b2.png'] }
      ])
    ).toEqual({
      a: ['Cache/a.png'],
      b: ['Cache/b.png', 'Cache/b2.png']
    })
  })
})
