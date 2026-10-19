import { describe, expect, it } from 'vitest'
import { createDefaultDirectorStage } from '../src/shared/domain'
import {
  FILM_STORYBOARD_SCHEMA,
  composeFilmShotImagePrompt,
  parseFilmStoryboard,
  replaceFilmShots,
  type FilmStoryboard
} from '../src/shared/graph/film/storyboard'
import {
  compileStoryboardToDirectorStage,
  compileStoryboardToDirectorStageWithLlm,
  extractStoryboardShotIdFromDirectorId
} from '../src/renderer/src/features/director/directorStoryboardPreviz'

function createSampleStoryboard(): FilmStoryboard {
  return {
    schema: FILM_STORYBOARD_SCHEMA,
    title: '暗夜行动',
    logline: '林夏在审讯室追问陈默密钥下落',
    aspectRatio: '16:9',
    style: '赛博朋克写实电影感',
    entities: [
      { id: 'E1', name: '林夏', kind: 'character', description: '女特工，短发风衣' },
      { id: 'E2', name: '陈默', kind: 'character', description: '线人，戴眼镜' },
      { id: 'E3', name: '全息审讯桌', kind: 'prop', description: '发光金属长桌' },
      { id: 'E4', name: '地下审讯室', kind: 'location', description: '霓虹冷光审讯室' }
    ],
    scenes: [
      {
        id: 'S01',
        order: 1,
        heading: 'INT. 地下审讯室 - 夜',
        location: '地下审讯室',
        time: '夜',
        summary: '林夏质问陈默'
      },
      {
        id: 'S02',
        order: 2,
        heading: 'INT. 霓虹长廊 - 夜',
        location: '霓虹长廊',
        time: '夜',
        summary: '陈默夺门奔跑'
      }
    ],
    shots: [
      {
        id: 'S01-01',
        order: 1,
        sceneId: 'S01',
        title: '审讯室全景对峙',
        durationSec: 4,
        shotSize: '全景',
        angle: '平视',
        cameraMove: '缓慢推进',
        location: '地下审讯室',
        characters: ['林夏', '陈默'],
        props: ['全息审讯桌'],
        action: '林夏与陈默隔着审讯桌对视',
        dialogue: [],
        sound: '低频电流嗡鸣',
        transition: '叠化',
        imagePrompt: '全景画面，林夏与陈默在审讯桌两侧对峙',
        videoPrompt: '镜头缓慢推进',
        status: 'draft'
      },
      {
        id: 'S01-02',
        order: 2,
        sceneId: 'S01',
        title: '林夏过肩特写',
        durationSec: 3,
        shotSize: '特写',
        angle: '过肩',
        cameraMove: '固定',
        location: '地下审讯室',
        characters: ['林夏', '陈默'],
        props: [],
        action: '林夏眼神冷峻，拍桌质问',
        dialogue: [{ speaker: '林夏', line: '把密钥交出来。' }],
        sound: '拍桌声',
        transition: '硬切',
        imagePrompt: '过肩特写林夏面部表情',
        videoPrompt: '手持呼吸感微颤',
        status: 'approved'
      },
      {
        id: 'S02-01',
        order: 3,
        sceneId: 'S02',
        title: '走廊追逐跟拍',
        durationSec: 5,
        shotSize: '中景',
        angle: '低角度',
        cameraMove: '环绕',
        location: '霓虹长廊',
        characters: ['陈默'],
        props: [],
        action: '陈默在走廊中全力奔跑逃离',
        dialogue: [],
        sound: '急促脚步声',
        transition: '硬切',
        imagePrompt: '低角度跟拍陈默奔跑',
        videoPrompt: '环绕跟拍陈默奔跑',
        status: 'approved'
      }
    ]
  }
}

describe('directorStoryboardPreviz', () => {
  it('compiles storyboard shots into 3D white-box actors, geometric props, cameras, and cut track', () => {
    const baseStage = createDefaultDirectorStage()
    const storyboard = createSampleStoryboard()

    const result = compileStoryboardToDirectorStage(baseStage, storyboard)

    expect(result.shotCount).toBe(3)
    expect(result.actorCount).toBe(2)
    expect(result.propCount).toBeGreaterThanOrEqual(1)
    expect(result.totalDurationSec).toBe(12)

    const characters = result.stage.objects.filter((o) => o.kind === 'character')
    expect(characters.map((c) => c.name)).toEqual(['林夏', '陈默'])
    // 180-degree axis: first two actors face each other across X axis
    expect(characters[0].position.x).toBeLessThan(0)
    expect(characters[1].position.x).toBeGreaterThan(0)

    const props = result.stage.objects.filter((o) => o.kind === 'primitive')
    expect(props.some((p) => p.name.includes('全息审讯桌'))).toBe(true)

    const cameras = result.stage.cameras ?? []
    expect(cameras).toHaveLength(3)
    expect(cameras.map((c) => extractStoryboardShotIdFromDirectorId(c.id))).toEqual([
      'S01-01',
      'S01-02',
      'S02-01'
    ])

    // Close-up shot S01-02 should aim at head and use telephoto focal length
    const closeUpCam = cameras[1]
    expect(closeUpCam.viewer.focalLengthMm).toBeGreaterThanOrEqual(85)
    expect(closeUpCam.viewer.cinemachine?.aimTargetPart).toBe('head')

    // Orbit shot S02-01 should configure orbital Cinemachine body
    const orbitCam = cameras[2]
    expect(orbitCam.viewer.cinemachine?.bodyMode).toBe('orbital')

    // Cut track should have 3 segments matching shot durations
    const cutTrack = result.stage.animation?.tracks.find((t) => t.cameraCut)
    const cutSegments = cutTrack?.cameraSegments ?? []
    expect(cutSegments).toHaveLength(3)
    expect(cutSegments[0].start).toBe(0)
    expect(cutSegments[0].end).toBe(4)
    expect(cutSegments[1].start).toBe(4)
    expect(cutSegments[1].end).toBe(7)
    expect(cutSegments[2].start).toBe(7)
    expect(cutSegments[2].end).toBe(12)
    expect(extractStoryboardShotIdFromDirectorId(cutSegments[1].id)).toBe('S01-02')

    // Actor skeletal animation clips should infer Run for S02-01 ("奔跑")
    const chenMoTrack = result.stage.animation?.tracks.find((t) => t.targetId === characters[1].id)
    expect(chenMoTrack?.skeletonClips?.some((clip) => clip.clip === 'Run')).toBe(true)
  })

  it('supports filtering by sceneId or single shotId', () => {
    const baseStage = createDefaultDirectorStage()
    const storyboard = createSampleStoryboard()

    const sceneOnly = compileStoryboardToDirectorStage(baseStage, storyboard, { sceneId: 'S01' })
    expect(sceneOnly.shotCount).toBe(2)
    expect(sceneOnly.totalDurationSec).toBe(7)

    const singleShot = compileStoryboardToDirectorStage(baseStage, storyboard, { shotId: 'S01-02' })
    expect(singleShot.shotCount).toBe(1)
    expect(singleShot.totalDurationSec).toBe(3)
    expect(singleShot.stage.activeCameraId).toBe('cam:sb:S01-02')
  })

  it('preserves previzKeyframe in storyboard serialization and injects @N previz reference into final prompt', () => {
    const storyboard = createSampleStoryboard()
    const updated = replaceFilmShots(storyboard, [
      {
        ...storyboard.shots[0],
        media: {
          previzKeyframe: 'assets/previz/shot_01.png',
          keyframe: 'assets/renders/shot_01.png'
        }
      }
    ])

    const reparsed = parseFilmStoryboard(JSON.stringify(updated))
    expect(reparsed?.shots[0].media?.previzKeyframe).toBe('assets/previz/shot_01.png')
    expect(reparsed?.shots[0].media?.keyframe).toBe('assets/renders/shot_01.png')

    const castRefs = [
      { id: 'c1', kind: 'character' as const, name: '林夏', description: '', image: 'a.png' },
      { id: 'c2', kind: 'character' as const, name: '陈默', description: '', image: 'b.png' }
    ]

    const promptZh = composeFilmShotImagePrompt(reparsed!, reparsed!.shots[0], castRefs, 'zh-CN', {
      previzRefIndex: 3
    })

    expect(promptZh).toContain('@3')
    expect(promptZh).toContain('3D 导演台预演构图参考')
    expect(promptZh).toContain('@1')
    expect(promptZh).toContain('@2')

    const promptEn = composeFilmShotImagePrompt(reparsed!, reparsed!.shots[0], castRefs, 'en-US', {
      previzRefIndex: 3
    })
    expect(promptEn).toContain('@3')
    expect(promptEn).toContain('3D Previz & Blocking Reference')
  })

  it('builds multi-part compound white-models with physical desk/tabletop placement and scopes entities to the active shot', () => {
    const baseStage = createDefaultDirectorStage()
    // Simulate a leftover unrelated quadruped mannequin on the stage
    baseStage.objects.push({
      id: 'obj_leftover_quadruped',
      name: 'Mannequin (Quadruped)',
      kind: 'character',
      mannequinPreset: 'quadruped',
      color: '#ff9000',
      visible: true,
      locked: false,
      nameVisible: true,
      position: { x: 0, y: -0.8, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    })

    const officeStoryboard: FilmStoryboard = {
      schema: FILM_STORYBOARD_SCHEMA,
      title: '深夜加班',
      logline: '林晓深夜在格子间工位加班',
      aspectRatio: '16:9',
      style: '写实电影感',
      entities: [
        { id: 'C1', name: '林晓 (打工人)', kind: 'character', description: '疲惫的年轻白领' },
        { id: 'L1', name: '办公室格子间', kind: 'location', description: '密集压抑的现代办公区' },
        { id: 'P1', name: '电脑显示器', kind: 'prop', description: '发光的办公屏幕' },
        { id: 'P2', name: '文件堆', kind: 'prop', description: '厚重的文件山' },
        { id: 'P3', name: '咖啡杯', kind: 'prop', description: '第二镜出现的咖啡杯' },
        { id: 'P4', name: '辞职信', kind: 'prop', description: '第三镜出现的辞职信' },
        { id: 'P5', name: '手机', kind: 'prop', description: '第三镜出现的手机' }
      ],
      scenes: [
        {
          id: 'S01',
          order: 1,
          heading: 'INT. 办公室格子间 - 夜',
          location: '办公室格子间',
          time: '夜',
          summary: '林晓在工位加班'
        }
      ],
      shots: [
        {
          id: 'S01-01',
          order: 1,
          sceneId: 'S01',
          title: '格子间全景加班',
          durationSec: 3,
          shotSize: '全景',
          angle: '俯拍',
          cameraMove: '固定',
          location: '办公室格子间',
          characters: ['林晓 (打工人)'],
          props: ['电脑显示器', '文件堆'],
          action:
            '深夜的办公室一片死寂，只有林晓的工位还亮着惨白的光。林晓瘫坐在工位上，双手无力地搭在键盘上，双眼无神地盯着发亮的电脑显示器，桌上文件堆积如山。',
          dialogue: [],
          sound: '空调嗡嗡声',
          transition: '硬切',
          imagePrompt: '全景俯拍，深夜幽暗的现代办公室格子间，林晓瘫坐在工位上',
          videoPrompt: '固定镜头',
          status: 'draft'
        },
        {
          id: 'S01-02',
          order: 2,
          sceneId: 'S01',
          title: '拿起咖啡杯',
          durationSec: 3,
          shotSize: '近景',
          angle: '平视',
          cameraMove: '固定',
          location: '办公室格子间',
          characters: ['林晓 (打工人)'],
          props: ['咖啡杯', '辞职信', '手机'],
          action: '林晓看了一眼手机和辞职信，端起咖啡杯',
          dialogue: [],
          sound: '',
          transition: '硬切',
          imagePrompt: '',
          videoPrompt: '',
          status: 'draft'
        }
      ]
    }

    const res = compileStoryboardToDirectorStage(baseStage, officeStoryboard, {
      shotId: 'S01-01'
    })
    const baseY = baseStage.gridOffsetY ?? -0.8

    // 1. Leftover Mannequin (Quadruped) and props from S01-02 should NOT leak into S01-01
    expect(res.stage.objects.some((o) => o.name.includes('Quadruped'))).toBe(false)
    expect(res.stage.objects.some((o) => o.name === '咖啡杯')).toBe(false)
    expect(res.stage.objects.some((o) => o.name === '辞职信')).toBe(false)
    expect(res.stage.objects.some((o) => o.name === '手机')).toBe(false)

    // 2. Actor should be in slumped sitting pose (lowered root Y and bent legs)
    const actor = res.stage.objects.find((o) => o.kind === 'character')
    expect(actor?.name).toContain('林晓')
    expect(actor?.position.y).toBeLessThan(baseY - 0.3)
    expect(actor?.bonePose?.LeftUpLeg?.x).toBeLessThan(-1.0)

    // 3. Supporting desk & chair should be inferred automatically
    const deskRoot = res.stage.objects.find((o) => o.kind === 'empty' && o.name === '办公桌')
    const chairRoot = res.stage.objects.find((o) => o.kind === 'empty' && o.name === '工位椅')
    expect(deskRoot).toBeDefined()
    expect(chairRoot).toBeDefined()

    // 4. Monitor and file stack should be multi-part compound white-models placed ON TOP of the desk (y = baseY + 0.74)
    const monitorRoot = res.stage.objects.find((o) => o.kind === 'empty' && o.name === '电脑显示器')
    const filesRoot = res.stage.objects.find((o) => o.kind === 'empty' && o.name === '文件堆')
    expect(monitorRoot).toBeDefined()
    expect(filesRoot).toBeDefined()
    expect(monitorRoot?.position.y).toBeCloseTo(baseY + 0.74, 2)
    expect(filesRoot?.position.y).toBeCloseTo(baseY + 0.74, 2)

    const monitorParts = res.stage.objects.filter((o) => o.parentId === monitorRoot?.id)
    expect(monitorParts.length).toBeGreaterThanOrEqual(3)
    expect(monitorParts.every((p) => p.nameVisible === false)).toBe(true)
  })

  it('uses LLM to design custom multi-part white-models and spatial coordinates when compileStoryboardToDirectorStageWithLlm is called', async () => {
    const baseStage = createDefaultDirectorStage()
    const storyboard = createSampleStoryboard()

    const result = await compileStoryboardToDirectorStageWithLlm(baseStage, storyboard, {
      shotId: 'S01-01',
      generateText: async () => ({
        text: JSON.stringify({
          actors: [
            {
              name: '林夏',
              posture: 'standing',
              position: { x: -0.95, y: 0, z: 0.25 },
              rotationY: 85
            },
            {
              name: '陈默',
              posture: 'sitting',
              position: { x: 0.95, y: 0, z: 0.25 },
              rotationY: -95
            }
          ],
          objects: [
            {
              name: '全息审讯桌',
              role: 'furniture',
              position: { x: 0, y: 0, z: 0.25 },
              rotationY: 0,
              parts: [
                {
                  name: '金属桌面',
                  primitive: 'box',
                  offset: { x: 0, y: 0.74, z: 0 },
                  scale: { x: 1.6, y: 0.06, z: 0.8 },
                  color: '#4a5568'
                },
                {
                  name: '全息投影柱',
                  primitive: 'cylinder',
                  offset: { x: 0, y: 0.95, z: 0 },
                  scale: { x: 0.35, y: 0.35, z: 0.35 },
                  color: '#63b3ed'
                }
              ]
            }
          ]
        })
      })
    })

    expect(result.usedLlm).toBe(true)
    const tableRoot = result.stage.objects.find(
      (o) => o.kind === 'empty' && o.name === '全息审讯桌'
    )
    expect(tableRoot).toBeDefined()
    const parts = result.stage.objects.filter((o) => o.parentId === tableRoot?.id)
    expect(parts).toHaveLength(2)
    expect(parts.map((p) => p.primitive)).toEqual(['box', 'cylinder'])
  })
})
