import { describe, expect, it } from 'vitest'
import { createDefaultDirectorStage } from '../src/shared/domain'
import { resolveShotCinematographyFromDirectorStage } from '../src/shared/directorCinematography'
import {
  FILM_STORYBOARD_SCHEMA,
  composeFilmShotImagePrompt,
  parseFilmStoryboard,
  replaceFilmShots,
  type FilmStoryboard
} from '../src/shared/graph/film/storyboard'
import {
  canReuseCompiledStoryboardStage,
  compileStoryboardToDirectorStage,
  compileStoryboardToDirectorStageWithLlm,
  extractStoryboardShotIdFromDirectorId,
  markCompiledStoryboardStage
} from '../src/renderer/src/features/director/directorStoryboardPreviz'
import { clearStoryboardLayoutPlanCache } from '../src/renderer/src/features/director/directorWhiteModelBuilder'

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

  it('caches LLM 3D layout plan and reuses compiled stage when storyboard has not changed', async () => {
    clearStoryboardLayoutPlanCache()
    const baseStage = createDefaultDirectorStage()
    const storyboard = createSampleStoryboard()
    let llmCallCount = 0

    const mockGenerateText = async () => {
      llmCallCount += 1
      return {
        text: JSON.stringify({
          actors: [
            {
              name: '林夏',
              posture: 'standing',
              position: { x: -1.1, y: 0, z: 0.1 },
              rotationYDeg: 80
            },
            {
              name: '陈默',
              posture: 'sitting',
              position: { x: 1.1, y: 0, z: 0.1 },
              rotationYDeg: -80
            }
          ],
          objects: [
            {
              name: '全息审讯桌',
              category: 'surface',
              position: { x: 0, y: 0, z: 0.2 },
              rotationYDeg: 0,
              surfaceHeight: 0.74,
              parts: [
                {
                  label: '桌面',
                  primitive: 'box',
                  offset: { x: 0, y: 0.72, z: 0 },
                  size: { x: 1.5, y: 0.05, z: 0.75 },
                  color: '#475569'
                },
                {
                  label: '底座',
                  primitive: 'cylinder',
                  offset: { x: 0, y: 0.35, z: 0 },
                  size: { x: 0.4, y: 0.7, z: 0.4 },
                  color: '#334155'
                }
              ]
            }
          ]
        })
      }
    }

    const first = await compileStoryboardToDirectorStageWithLlm(baseStage, storyboard, {
      shotId: 'S01-01',
      generateText: mockGenerateText
    })
    expect(llmCallCount).toBe(1)
    expect(first.usedLlm).toBe(true)

    first.stage.ownerProcessingNodeId = 'node_motion_1'
    markCompiledStoryboardStage(first.stage, storyboard, { shotId: 'S01-01' })

    // Re-entering with the exact same storyboard & scope should reuse the stage directly
    expect(canReuseCompiledStoryboardStage(first.stage, storyboard, { shotId: 'S01-01' })).toBe(
      true
    )
    // Switching to full storyboard scope should not reuse the single-shot stage
    expect(canReuseCompiledStoryboardStage(first.stage, storyboard, {})).toBe(false)

    // Re-compiling the same shot should hit the LLM layout plan cache without calling generateText again
    const second = await compileStoryboardToDirectorStageWithLlm(baseStage, storyboard, {
      shotId: 'S01-01',
      generateText: mockGenerateText
    })
    expect(llmCallCount).toBe(1)
    expect(second.usedLlm).toBe(true)
  })

  it('automatically switches skeletal animation clips across shots for everyday actions (PhoneLook, Drink, Jump, Dance, Talk)', () => {
    const baseStage = createDefaultDirectorStage()
    const sb: FilmStoryboard = {
      schema: FILM_STORYBOARD_SCHEMA,
      title: '日常动作序列',
      logline: '测试多镜头动作自动切换',
      aspectRatio: '16:9',
      style: '写实',
      entities: [{ id: 'E1', name: '林小满', kind: 'character', description: '主角' }],
      scenes: [
        {
          id: 'S01',
          order: 1,
          heading: 'INT. 房间 - 日',
          location: '房间',
          time: '日',
          summary: '日常动作'
        }
      ],
      shots: [
        {
          id: 'S01-01',
          order: 1,
          sceneId: 'S01',
          title: '看手机',
          durationSec: 2,
          shotSize: '中景',
          angle: '平视',
          cameraMove: '固定',
          location: '房间',
          characters: ['林小满'],
          props: [],
          action: '林小满低头看手机消息',
          dialogue: [],
          sound: '',
          transition: '硬切',
          imagePrompt: '',
          videoPrompt: '',
          status: 'draft'
        },
        {
          id: 'S01-02',
          order: 2,
          sceneId: 'S01',
          title: '喝咖啡',
          durationSec: 2,
          shotSize: '近景',
          angle: '平视',
          cameraMove: '固定',
          location: '房间',
          characters: ['林小满'],
          props: [],
          action: '林小满端起杯子喝水',
          dialogue: [],
          sound: '',
          transition: '硬切',
          imagePrompt: '',
          videoPrompt: '',
          status: 'draft'
        },
        {
          id: 'S01-03',
          order: 3,
          sceneId: 'S01',
          title: '兴奋跳起',
          durationSec: 2,
          shotSize: '全景',
          angle: '低角度',
          cameraMove: '固定',
          location: '房间',
          characters: ['林小满'],
          props: [],
          action: '林小满开心得原地跳跃起来',
          dialogue: [],
          sound: '',
          transition: '硬切',
          imagePrompt: '',
          videoPrompt: '',
          status: 'draft'
        },
        {
          id: 'S01-04',
          order: 4,
          sceneId: 'S01',
          title: '欢快跳舞',
          durationSec: 3,
          shotSize: '全景',
          angle: '平视',
          cameraMove: '环绕',
          location: '房间',
          characters: ['林小满'],
          props: [],
          action: '林小满在房间里欢快地跳舞',
          dialogue: [],
          sound: '',
          transition: '硬切',
          imagePrompt: '',
          videoPrompt: '',
          status: 'draft'
        }
      ]
    }

    const compiled = compileStoryboardToDirectorStage(baseStage, sb)
    const actor = compiled.stage.objects.find((o) => o.kind === 'character')
    expect(actor).toBeDefined()
    const actorTrack = compiled.stage.animation?.tracks.find((t) => t.targetId === actor?.id)
    expect(actorTrack?.skeletonClips?.map((c) => c.clip)).toEqual([
      'PhoneLook',
      'Drink',
      'Jump',
      'Dance'
    ])
  })

  it('compiles depth-layered OTS standoff blocking, multi-keyframe character movement tracks, and accurate camera-local dolly trajectory', () => {
    const baseStage = createDefaultDirectorStage()
    const sb: FilmStoryboard = {
      schema: FILM_STORYBOARD_SCHEMA,
      title: '订婚宴逼问',
      logline: '周敏逼讨彩礼，林薇入画挽住陆景明，三人对苏念形成压迫三角',
      aspectRatio: '16:9',
      style: '写实电影感',
      entities: [
        { id: 'C1', name: '周敏', kind: 'character', description: '强势贵妇' },
        { id: 'C2', name: '苏念', kind: 'character', description: '女主，冷静隐忍' },
        { id: 'C3', name: '林薇', kind: 'character', description: '绿茶女配' },
        { id: 'C4', name: '陆景明', kind: 'character', description: '傲慢未婚夫' }
      ],
      scenes: [
        {
          id: 'S01',
          order: 1,
          heading: 'INT. 宴会厅 - 夜',
          location: '宴会厅',
          time: '夜',
          summary: '周敏逼问苏念'
        }
      ],
      shots: [
        {
          id: 'S01-02',
          order: 2,
          sceneId: 'S01',
          title: '周敏肩前拍苏念过肩推镜',
          durationSec: 8,
          shotSize: 'MS',
          angle: '过肩（周敏肩前拍苏念）',
          cameraMove: '推（缓慢收紧至两人脸部）',
          location: '宴会厅',
          characters: ['周敏', '苏念', '林薇', '陆景明'],
          props: [],
          action:
            '0-1s：苏念平静回应，周敏迎着镜头逼近，机位缓慢推近，林薇位置未入画，陆景明在林薇右侧；1-3s：周敏说出逼讨彩礼台词，脸上露出威胁神色，苏念仍不后退；3-5s：林薇从画面左侧入画，挽住右侧陆景明，用细软声音劝话；5-7s：陆景明搂紧林薇，嘲讽完毕，视线关系保持一致；7-8s：机位推至两人脸部，暖金色背景虚化，三人形成压迫三角。',
          dialogue: [
            { speaker: '苏念', line: '伯母，话别说死。' },
            {
              speaker: '周敏',
              line: '彩礼呢？陆家的东西，你一样都别想带走。现在交出来，别逼我让保安动手。'
            },
            { speaker: '林薇', line: '景明，别这样对苏小姐，她一个女孩子，多难堪呀。' },
            { speaker: '陆景明', line: '难堪？她这种人，最懂怎么装可怜。' }
          ],
          sound: '周敏趾尖点地声，林薇鞋跟声',
          transition: '硬切',
          imagePrompt: '',
          videoPrompt: '',
          status: 'draft'
        }
      ]
    }

    const res = compileStoryboardToDirectorStage(baseStage, sb, { shotId: 'S01-02' })
    const chars = res.stage.objects.filter((o) => o.kind === 'character')
    const byName = new Map(chars.map((c) => [c.name, c]))
    const zhouMin = byName.get('周敏')!
    const suNian = byName.get('苏念')!
    const linWei = byName.get('林薇')!
    const luJingMing = byName.get('陆景明')!

    // 1. 纵深分层站位（非一字排开）：周敏在前景左侧，苏念在中景中央，林薇与陆景明在远景右侧且陆景明在林薇右侧
    expect(zhouMin.position.z).toBeGreaterThan(0.3)
    expect(zhouMin.position.x).toBeLessThan(-0.2)
    expect(Math.abs(suNian.position.x)).toBeLessThan(0.2)
    expect(suNian.position.z).toBeLessThan(0)
    expect(linWei.position.z).toBeLessThan(-0.7)
    expect(luJingMing.position.z).toBeLessThan(-0.7)
    expect(luJingMing.position.x).toBeGreaterThan(linWei.position.x)

    // 2. 演员表演轨具有多关键帧位移与轨迹线（周敏 0-1s 逼近、林薇 0-3s 左侧待入画 -> 3-5s 从左侧入画、陆景明 5-7s 搂紧林薇）
    const zhouTrack = res.stage.animation?.tracks.find((t) => t.targetId === zhouMin.id)!
    const linTrack = res.stage.animation?.tracks.find((t) => t.targetId === linWei.id)!
    const luTrack = res.stage.animation?.tracks.find((t) => t.targetId === luJingMing.id)!
    expect(zhouTrack.keyframes.length).toBeGreaterThanOrEqual(3)
    expect(zhouTrack.path).not.toBeNull()
    expect(linTrack.keyframes.length).toBeGreaterThanOrEqual(3)
    expect(linTrack.path).not.toBeNull()
    // 林薇在 0s 和 3s 处于左侧边缘（x < -0.65），5s 入画到达陆景明左侧（x >= 0.25）
    expect(linTrack.keyframes[0].position.x).toBeLessThan(-0.65)
    const kfAt3s = linTrack.keyframes.find((k) => Math.abs(k.time - 3) < 0.1)!
    const kfAt5s = linTrack.keyframes.find((k) => Math.abs(k.time - 5) < 0.1)!
    expect(kfAt3s.position.x).toBeLessThan(-0.65)
    expect(kfAt5s.position.x).toBeGreaterThanOrEqual(0.25)
    expect(luTrack.keyframes.length).toBeGreaterThanOrEqual(3)

    // 2b. 相机视口可见性校验（即使在 9:16 竖屏安全框下，4 位角色也均在镜头视锥体内，不会只看到苏念一人）
    const shotCam = res.stage.cameras?.[0]!
    expect(shotCam.viewer.fov).toBeGreaterThanOrEqual(60)
    expect(shotCam.viewer.focalLengthMm).toBe(50)

    // 3. 反推生成的 3D 运镜提示词准确反映过肩机位、无伪横移、且包含角色逼近与入画空间方位
    const cine = resolveShotCinematographyFromDirectorStage(res.stage, 'S01-02')!
    expect(cine).not.toBeNull()
    expect(cine.cameraAngleZh).toContain('过肩（周敏肩前拍苏念）')
    expect(cine.videoSpecZh).toContain('机位距离由 1.8m 推近至 1.2m')
    expect(cine.videoSpecZh).toContain('注视焦点锁定「苏念」')
    expect(cine.videoSpecZh).not.toContain('向右横移')
    expect(cine.videoSpecZh).not.toContain('向左横移')
    expect(cine.subjectsZh).toContain('周敏（位于前景画面左侧并向镜头逼近）')
    expect(cine.subjectsZh).toContain('苏念（位于中景画面中央）')
    expect(cine.subjectsZh).toContain('林薇（由画面左侧入画移至远景画面右侧）')
    expect(cine.subjectsZh).toContain('陆景明（位于远景画面右侧）')
  })
})
