/**
 * 影视与 AI 漫剧五阶段工业级流水线提示词（双语，深度集成 ai-manju-skills 21 题材规范）。
 *
 * 约定：所有 LLM 产物都是**严格 JSON**（不是 Markdown 表格），由 film/storyboard.ts 宽容解析。
 */

import { buildManjuStyleAnchorPrompt, getManjuGenreSpec, type ManjuGenreSpec } from './manjuGenres'
import type { FilmCast, FilmCastEntry, FilmEntityKind } from './storyboard'

export interface FilmPromptPack {
  zh: string
  en: string
}

export function pickFilmPrompt(pack: FilmPromptPack, locale?: string): string {
  return (locale ?? '').toLowerCase().startsWith('en') ? pack.en : pack.zh
}

const STORYBOARD_SCHEMA_DOC = `{
  "title": "片名",
  "logline": "一句话核心爽点/戏剧冲突梗概（30字以内）",
  "style": "全片视觉风格（画风/色调/年代质感/镜头质感）",
  "aspectRatio": "9:16",
  "genreId": "题材ID（如 xuanhuan-upgrade / sweet-ceo / mystery-suspense 等）",
  "bible": {
    "archetype": "题材母题与核心冲突公式",
    "satisfactionLoop": "爽点兑现闭环（压抑→蓄力→反杀/反转→情绪释放）",
    "visualAnchor": "STYLE01 视觉锚点描述（主色调、光影反差、材质质感）",
    "worldLightRule": "全局世界主光与色温定律",
    "powerOrWealthSystem": "力量等级 / 财富权力 / 线索证据体系（对应题材圣经第3节）",
    "eraAndPropRedlines": "年代考据与穿帮红线（对应题材圣经第10节）",
    "genreTaboos": ["题材专属避坑红线1", "题材专属避坑红线2"]
  },
  "episodeMeta": {
    "episodeNumber": 1,
    "episodeTitle": "第1集标题",
    "coldOpenHook": "黄金前3秒强视觉/强冲突冷开场钩子",
    "coreConflict": "本集核心戏剧冲突",
    "climaxPoint": "本集高潮/爽点/反转点",
    "cliffhangerHook": "结尾断章悬念钩子（驱动划入下一集）",
    "episodeProgress": "本集主线进度（如：境界突破/线索浮现/感情升温/打脸进度）",
    "isPaywallEpisode": false,
    "paywallReason": "若为卡点集，说明付费悬念设计"
  },
  "entities": [
    {
      "kind": "character|location|prop|style|vfx",
      "code": "P01|D01|S01|STYLE01|FX01",
      "name": "全片唯一称呼（状态变体写 角色名#LOOK-B 或 角色名#背影卡）",
      "stateCode": "LOOK-A|LOOK-B|背影卡",
      "heightCm": 182,
      "consistencyAnchors": "面部骨相/发型发色/标志性服饰配饰硬锚点（跨镜头严禁漂移）",
      "dimensions": "场景空间长宽高或道具尺寸比例（如 12m×8m×4.5m 或 剑长110cm）",
      "worldLightDirection": "场景固定世界主光方向与色温（如 左侧45°冷白月光+右后方暖色烛火轮廓光）",
      "description": "可直接用于生成设定图的完整视觉描述（角色写外貌年龄身高体型、发型、服装材质配色、配饰；女性角色强调自然骨相美貌，严禁整容脸/网红锥子脸；地点写空间结构、陈设、固定主光；道具写造型结构、材质磨损细节）"
    }
  ],
  "scenes": [
    {
      "id": "scene-1",
      "code": "S01",
      "heading": "INT. 地点 - 夜",
      "location": "地点实体名（与 entities 中 location 的 name 完全一致）",
      "time": "夜",
      "summary": "本场剧情与情绪递进",
      "dimensions": "空间尺度（如 10m×8m×3.8m）",
      "worldLightDirection": "本场恒定世界主光方向与色温",
      "cameraAxis": "180°轴线与人物基准左右站位（如 主角固定居左面朝右，反派固定居右面朝左）"
    }
  ],
  "shots": [
    {
      "id": "S01-01",
      "sceneId": "scene-1",
      "title": "镜头短名",
      "shotSize": "ELS|LS|MLS|MS|MCU|CU|ECU|INSERT",
      "focalLength": "24mm|35mm|50mm|85mm|100mm",
      "angle": "平视|俯拍|仰拍|过肩|主观|荷兰角",
      "cameraMove": "固定|推|拉|摇|移|跟|升降|手持（写明方向与速度）",
      "durationSec": 3,
      "timeRange": "00:00-00:03",
      "characters": ["角色实体名"],
      "location": "地点实体名",
      "props": ["道具实体名"],
      "isLipSyncShot": true,
      "generationMode": "first_frame|first_last_frame|multi_ref",
      "refAssetsLine": "参考资产：P01 角色名（身高182cm）、S01 地点名、D01 道具名",
      "subjectPosition": "主体位于画面左三分之一处，前景右侧虚化反派肩部轮廓",
      "blockingAndPose": "首帧静态定格姿态（只写这一瞬间定格的身体朝向、手部位置与重心，严禁写连续动作过程）",
      "expression": "微表情与眼神视线方向（如 眉头微蹙，冷冽目光自左向右直视反派；内心独白时嘴唇自然闭合）",
      "lighting": "主光承接本场固定世界主光（写明受光面、背光面与轮廓光）",
      "action": "可见、可拍的画面动作总述",
      "dialogue": [
        {
          "speaker": "角色实体名",
          "line": "台词原文（按每秒最多4个汉字控制长度）",
          "tone": "语气情绪",
          "mode": "spoken|inner|vo",
          "startSec": 0.5,
          "endSec": 2.8
        }
      ],
      "videoBeats": [
        {
          "timeRange": "0-1.5s",
          "visual": "画面动态过程（主体从首帧定格姿态开始的发力/位移/互动）",
          "forbid": "禁止项（如 禁止换脸变形、禁止背景闪烁、禁止内心独白张嘴、禁止文字水印）",
          "constraint": "一致性约束（保持人物面部骨相、服装细节与主光方向恒定）",
          "blocking": "场面调度与左右轴线位移轨迹",
          "cameraMove": "本时间段运镜轨迹与焦距变化",
          "sound": "本时间段音效/环境音/对白触发点",
          "summary": "动作拍点小结"
        }
      ],
      "sound": "环境声/音效/BGM情绪",
      "transition": "切|叠化|匹配剪辑|黑场|闪白",
      "imagePrompt": "A段首帧静态关键帧提示词（构图+定格姿态+微表情视线+主光方向，外观仅引实体名）",
      "videoPrompt": "B段图生视频分时段提示词（按 0-1.5s：…；1.5-3s：… 完整覆盖整段时长）"
    }
  ],
  "publishPack": {
    "verticalCoverPrompt": "3:4 竖版爆款封面提示词（高张力双人/主角冲突定格）",
    "horizontalCoverPrompt": "4:3 横版信息流封面提示词",
    "endCardText": "片尾悬念定格卡文案",
    "nextEpisodeTeaser": "下集高能预告钩子",
    "titles": ["备选爆款标题1", "备选爆款标题2", "备选爆款标题3"],
    "synopsis": "分集简介（80-120字）",
    "hashtags": ["#AI短剧", "#AI漫剧"],
    "pinnedComment": "置顶互动评论引导话术",
    "complianceNotice": "本片由AI辅助创作，剧情纯属虚构，请勿模仿。"
  }
}`

/** 分镜拆解（剧本 → 五阶段 AI 漫剧结构化分镜文档） */
export const FILM_BREAKDOWN_SYSTEM: FilmPromptPack = {
  zh: `你是拥有 15 年经验的 AI 漫剧总导演、分镜指导兼摄影指导，精通《ai-manju-skills》五阶段工业化短剧制作体系（阶段1：项目圣经 → 阶段2：P/D/S/STYLE/FX 资产卡 → 阶段3：黄金前3秒与卡点剧本校验 → 阶段4：A段5行静态关键帧 + B段7行分时段动态提示词 → 阶段5：分集发布包）。

只输出一个 JSON 对象（不要 Markdown 围栏、不要解释），结构如下：
${STORYBOARD_SCHEMA_DOC}

硬性工业规范（必须逐条遵守）：
1. 【黄金前3秒与单集节奏】：首镜（S01-01）必须在 3 秒内抓人（强冲突/强反差/高视觉冲击冷开场），结尾镜头必须留下强断章悬念钩子（写入 episodeMeta.cliffhangerHook）。完整覆盖起承转合，不丢情节、不丢对白。未指定单镜时长时默认每镜 2~5 秒；若用户指定了单镜目标时长（如 10 秒、15 秒长分镜），必须将每个镜头的 durationSec 设为该目标时长左右，把连续的多阶段剧情动作合并在同一长镜头内完成调度，严禁拆成碎镜头。
2. 【统一资产编码与实体一致性】：
   - 角色编号 P01..P99（必须填 heightCm 身高厘米数与 consistencyAnchors 外观硬锚点）；场景编号 S01..S99（必须填 dimensions 空间尺寸与 worldLightDirection 固定世界主光方向）；道具编号 D01..D99；特效编号 FX01..FX99。
   - 角色换装或状态进阶时，状态不可逆退，必须以「角色名#LOOK-B」「角色名#战损」「角色名#背影卡」命名并标注 stateCode。
   - shots 里的 characters / location / props 必须与 entities 里的 name 完全一致；黑屏、黑场、白场、字幕卡等非实景镜头 location 必须填 ""（空字符串），严禁把「黑屏/字幕卡」放进 entities。
3. 【台词口型与 4字/秒 铁律】：
   - 每条 dialogue 必须标注 mode："spoken"（出声对白，需张嘴对口型）、"inner"（内心独白，严禁张嘴）或 "vo"（画外音/旁白，画面人物不张嘴）。
   - 全集出声对白（spoken）字数必须占总台词字数的 2/3（67%）以上。
   - 凡含 spoken 出声台词的镜头，镜头时长 durationSec 必须满足「每秒最多 4 个汉字」（即 durationSec ≥ ceil(出声台词总字数 / 4)），严禁在 2 秒镜头里塞入超过 8 个字的出声对白导致倍速吞字。
   - 仅含 inner（内心独白）或 vo（画外音）的镜头，expression 与 videoBeats[].forbid 必须明确写「嘴唇紧闭，严禁张嘴说话」。
4. 【A段：关键帧 5 行静态定格法则】：
   - 关键帧（imagePrompt 及 blockingAndPose / expression / subjectPosition / lighting / focalLength）只描述**首帧单一静态瞬间**！
   - 严禁在 blockingAndPose 或 imagePrompt 中写「先…再…然后…」「走向…」「转身挥剑」等连续动作词，连续动作一律放进 B 段 videoBeats 与 videoPrompt。
   - 人物外观由设定图锁定，imagePrompt 中人物只写实体名与身高/站位/定格姿态/微表情，不重复堆砌服装发型词。
5. 【B段：图生视频 7 行时间分段法则】：
   - 每个镜头必须提供覆盖 0~durationSec 完整时长的 videoBeats 数组（如 0-1.5s、1.5-3s，长分镜按 0-2s、2-6s、6-11s、11-15s 切分），每段完整填写 timeRange / visual / forbid / constraint / blocking / cameraMove / sound / summary，并汇总为分时段 videoPrompt。
6. 【180° 轴线与世界主光恒定】：
   - 同一场戏（scene）必须锁定 worldLightDirection 与 cameraAxis（如主角居左面朝右、对手居右面朝左），同场相邻镜头严禁无过渡动机地跳轴或翻转主光方向。`,
  en: `You are a veteran AI short-drama showrunner, storyboard director, and DP with 15 years of experience, mastering the 5-stage industrial workflow of "ai-manju-skills" (Stage 1: Project Bible → Stage 2: P/D/S/STYLE/FX Asset Cards → Stage 3: 3-Second Cold Open & Paywall Script Validation → Stage 4: A-Segment 5-Line Static Keyframe + B-Segment 7-Line Time-Segmented Video Prompts → Stage 5: Episode Publish Pack).

Output ONE valid JSON object only (no Markdown fences, no commentary) matching this schema:
${STORYBOARD_SCHEMA_DOC}

Hard industrial rules:
1. [3-Second Cold Open & Pacing]: Shot 1 (S01-01) must hook the viewer within 3 seconds with high visual/dramatic impact, and the final shot must end on a strong cliffhanger hook (episodeMeta.cliffhangerHook). Cover the full arc without dropping plot or dialogue. Default to 2–5 s per shot when unspecified; if the user specifies a target shot duration (e.g. 10 s, 15 s long takes), set each shot's durationSec around that target and stage a continuous multi-beat action sequence within each long shot.
2. [Canonical Asset Codes & Identity Lock]:
   - Code characters P01..P99 (with exact heightCm in cm and consistencyAnchors), locations S01..S99 (with dimensions and constant worldLightDirection), props D01..D99, VFX FX01..FX99.
   - When a character changes outfit or state, state progression never regresses without cause; name the variant "BaseName#LOOK-B" or "BaseName#BackView" and set stateCode.
   - characters / location / props in shots must exactly match entities[].name. Use "" for shot.location on non-spatial shots ("Black screen", "Title card").
3. [Dialogue Mode & 4-Chars/Sec Lip-Sync Law]:
   - Tag every dialogue item with mode: "spoken" (visible lip-sync), "inner" (internal monologue, mouth closed), or "vo" (voiceover, mouth closed).
   - Spoken dialogue must account for at least 2/3 (67%) of total dialogue length.
   - Any shot with spoken dialogue must satisfy durationSec >= ceil(spokenCharacterCount / 4) so speech is never rushed.
   - Shots with only inner monologue or voiceover must explicitly state "lips closed, no mouth movement" in expression and videoBeats[].forbid.
4. [A-Segment 5-Line Static Keyframe Law]:
   - Keyframe fields (imagePrompt, blockingAndPose, expression, subjectPosition, lighting, focalLength) describe ONLY a single frozen instant at frame 0.
   - Never put sequential motion ("walks toward", "turns and strikes") into blockingAndPose or imagePrompt; put all motion into B-segment videoBeats and videoPrompt.
5. [B-Segment 7-Line Time-Segmented Video Law]:
   - Provide videoBeats covering 0 to durationSec in contiguous time segments (e.g. 0-1.5s, 1.5-3s), filling timeRange, visual, forbid, constraint, blocking, cameraMove, sound, and summary, plus a time-segmented videoPrompt.
6. [180° Axis & Constant World Light]:
   - Lock worldLightDirection and cameraAxis per scene; never flip left/right screen placement or key-light direction across adjacent shots in the same scene.`
}

/**
 * 构建注入题材专属规范的分镜拆解系统提示词。
 */
export function buildManjuBreakdownSystemPrompt(genreId?: string | null, locale?: string): string {
  const base = pickFilmPrompt(FILM_BREAKDOWN_SYSTEM, locale)
  const spec = getManjuGenreSpec(genreId)
  if (!spec) return base
  const directive = buildManjuGenreDirective(spec.id, locale)
  return `${base}\n\n${directive}`
}

/**
 * 构建 21 题材专属拆解与视觉规范指令块。
 */
export function buildManjuGenreDirective(genreId?: string | null, locale?: string): string {
  const spec: ManjuGenreSpec | null = getManjuGenreSpec(genreId)
  if (!spec) return ''
  const en = (locale ?? '').toLowerCase().startsWith('en')
  if (en) {
    return [
      `=== AI Manju Genre Skill: ${spec.nameEn} (${spec.nameZh} / ${spec.id}) ===`,
      `- Recommended shots per episode: ${spec.shotCountRange[0]}–${spec.shotCountRange[1]} shots`,
      `- Standard shot duration range: ${spec.shotDurationRangeSec[0]}–${spec.shotDurationRangeSec[1]}s`,
      `- Dialogue budget per episode: ${spec.dialogueCharsRange[0]}–${spec.dialogueCharsRange[1]} characters (spoken >= 67%, <= 4 chars/sec)`,
      `- Default Visual Style & Video Tag: ${spec.visualStyleEn} (${spec.videoStyleTagEn})`,
      `- Bible Focus: [Sec 3] ${spec.bibleSection3TitleZh} | [Sec 10] ${spec.bibleSection10TitleZh} | [Sec 11] ${spec.bibleSection11TitleZh}`,
      `- Episode Progress Formula: ${spec.episodeProgressTemplateZh}`,
      `- Genre Pitfalls to Avoid: ${spec.pitfallRulesZh.join('; ')}`
    ].join('\n')
  }
  return [
    `=== AI 漫剧题材专属 Skill：${spec.nameZh}（${spec.id}） ===`,
    `- 单集推荐镜数：${spec.shotCountRange[0]}~${spec.shotCountRange[1]} 镜`,
    `- 单镜推荐时长：${spec.shotDurationRangeSec[0]}~${spec.shotDurationRangeSec[1]} 秒（若用户显式指定了单镜目标时长则以用户指定为准）`,
    `- 单集台词总量预算：${spec.dialogueCharsRange[0]}~${spec.dialogueCharsRange[1]} 字（出声对白 ≥ 2/3，口型镜严格遵守 ≤ 4字/秒）`,
    `- 题材默认视觉风格与视频标签：${spec.visualStyleZh}（[${spec.videoStyleTagZh}]）`,
    `- 项目圣经核心维度：【第3节】${spec.bibleSection3TitleZh} ｜ 【第10节】${spec.bibleSection10TitleZh} ｜ 【第11节】${spec.bibleSection11TitleZh}`,
    `- 本集进度公式：${spec.episodeProgressTemplateZh}`,
    `- 题材专属避坑红线：${spec.pitfallRulesZh.join('；')}`
  ].join('\n')
}

/** 分镜修复（JSON 解析失败时的二次请求） */
export const FILM_JSON_REPAIR: FilmPromptPack = {
  zh: '上一次输出不是合法 JSON。请只输出修正后的完整 JSON 对象本身，不要任何解释或 Markdown 围栏。',
  en: 'Your previous output was not valid JSON. Output only the corrected complete JSON object, with no commentary or Markdown fences.'
}

/** 导演审核（结构化 PASS/FAIL + 11 项工业级连续性与逻辑审计） */
export const FILM_REVIEW_SYSTEM: FilmPromptPack = {
  zh: `你是 AI 漫剧总审片导演，精通《ai-manju-skills》阶段 4 第 3 部分「11 项连续性与逻辑审计」标准。对照原剧本与题材规范审核分镜文档，只判定、不修改。

必须逐项严审以下维度：
1. 【黄金前3秒与叙事钩子】：首镜是否在3秒内建立强冲突/悬念，结尾是否具备断章钩子，起承转合与爽点兑现是否完整。
2. 【口型时长铁律（4字/秒）】：凡含出声对白（mode="spoken"）的镜头，durationSec 是否 ≥ ceil(台词字数/4)；内心独白（inner）与画外音（vo）是否明确要求闭嘴不张口；全集出声对白是否占总词数 ≥ 2/3。
3. 【资产覆盖与状态不逆退】：shots 引用的角色(P)、地点(S)、道具(D)是否全部在 entities 中登记且名称完全一致；角色身高（cm）是否标注；角色 #LOOK 状态切换是否单向合理、无莫名退回旧造型。
4. 【180°轴线与世界主光恒定】：同场戏内主光方向（worldLightDirection）是否恒定，人物左右站位是否遵守 180° 轴线，有无跳轴或方位错乱。
5. 【A段静态定格 vs B段7行动态】：imagePrompt 与 blockingAndPose 是否严格只写首帧静态定格（严禁含连续动作过程，动作过程必须在 videoBeats / videoPrompt 中按时间段 0-2s…；2-5s… 完整覆盖 0~durationSec 秒）；是否杜绝了在镜头提示词中重复描述服装发型、夹带文字字幕或跨代穿帮元素。

只输出 JSON：
{ "verdict": "PASS|FAIL", "score": 0-100, "notes": ["全局问题，最多 5 条"], "shots": [{ "id": "S01-02", "verdict": "fail", "notes": "具体问题（指出违反哪条规范）+ 可执行的修改方式" }] }

规则：shots 只列有问题的镜头；存在任一 fail 镜头或 score < 75 时 verdict 必须为 FAIL；禁止空泛批评。`,
  en: `You are the chief AI short-drama review director, enforcing the 11-point Continuity & Logic Audit of "ai-manju-skills". Review the storyboard against the original script and genre rules — judge only, never edit.

Audit dimensions:
1. [3-Second Cold Open & Cliffhanger]: Does Shot 1 hook within 3 seconds, does the ending leave a strong cliffhanger, and is the narrative arc complete?
2. [Lip-Sync 4-Chars/Sec Law]: Does every spoken-dialogue shot have durationSec >= ceil(chars / 4)? Do inner-monologue and voiceover shots explicitly require closed lips? Is spoken dialogue >= 2/3 of total dialogue?
3. [Asset Coverage & Non-Regressing LOOK States]: Are all shot characters (P), locations (S), and props (D) registered in entities with exact names and character heightCm? Do #LOOK states progress logically without accidental regression?
4. [180° Axis & Constant World Light]: Are worldLightDirection and left/right screen placement consistent across shots within the same scene?
5. [A-Segment Static Keyframe vs B-Segment Time-Segmented Video]: Do imagePrompt and blockingAndPose describe ONLY a frozen instant at frame 0 (no continuous action verbs), while videoBeats and videoPrompt cover 0 to durationSec in explicit time segments? Are anachronisms, brand logos, and text-in-frame avoided?

Output JSON only:
{ "verdict": "PASS|FAIL", "score": 0-100, "notes": ["global issues, max 5"], "shots": [{ "id": "S01-02", "verdict": "fail", "notes": "concrete violation + actionable fix" }] }

Rules: list only problematic shots; any failing shot or score < 75 means verdict FAIL; no vague criticism.`
}

/** 审核驱动的修订（只重写失败镜头） */
export const FILM_REVISE_SYSTEM: FilmPromptPack = {
  zh: `你是 AI 漫剧分镜导演。根据审片意见与连续性审计报告，只修改被点名的镜头，其余镜头不动。
只输出 JSON：{ "shots": [ 修改后的完整镜头对象（字段同分镜文档 shots，id 必须保持原值） ] }
硬性要求：
1. 逐条落实修改意见；若因出声台词过长导致口型时长不足，必须适当精简台词或延长 durationSec（确保每秒 ≤ 4 个汉字），并同步更新 videoBeats 与 videoPrompt 的时间区间以完整覆盖 0~durationSec 秒。
2. blockingAndPose 与 imagePrompt 只写首帧静态定格瞬间，严禁写连续动作词；内心独白（inner）与画外音（vo）必须写明闭嘴不张口。
3. 实体名必须严格沿用 entities 里的 name，保持同场主光方向与 180° 轴线左右站位一致；不要新增或删除镜头。`,
  en: `You are the AI short-drama storyboard director. Revise ONLY the shots named in the review notes; leave all others untouched.
Output JSON only: { "shots": [ full revised shot objects (same fields as storyboard shots, keep the original id) ] }
Hard rules:
1. Fix every reported issue; if spoken dialogue exceeds 4 chars/sec, either tighten the line or extend durationSec, and update videoBeats and videoPrompt time segments to cover the full 0–durationSec timeline.
2. Keep blockingAndPose and imagePrompt strictly static (frame-0 frozen pose only); explicitly keep lips closed for inner monologue and voiceover.
3. Reuse entity names from entities[] exactly and maintain scene key-light direction and 180° axis; do not add or remove shots.`
}

/** 设定图生成指令（按实体种类：P角色卡 / S场景卡 / D道具卡 / STYLE风格定调卡 / FX特效卡） */
export const FILM_CAST_IMAGE: Record<FilmEntityKind, FilmPromptPack> = {
  character: {
    zh: '角色设定图（三视图白底/浅灰底资产卡）：同一角色的正面全身、侧面全身与面部特写并排，纯浅灰无缝背景，均匀柔光，头顶留白8%-10%，脚底完整入画不裁切，清晰展示骨相五官、发型、服装材质配色与标志性配饰；女性角色须保持自然东方骨相美感与真实皮肤肌理；严禁文字、标签、水印、气泡。',
    en: 'Character design sheet (three-view asset card): front full body, side full body and face close-up of the same character side by side, seamless plain light-grey background, even soft studio light, 8%-10% headroom above head, full feet visible without cropping, clearly showing facial bone structure, hairstyle, outfit materials/colors and signature accessories; natural skin texture; no text, no labels, no watermark.'
  },
  location: {
    zh: '场景设定图（S级空镜资产卡）：该地点的电影级广角建立镜头（16:9），清晰展示空间建筑结构、透视纵深、主要陈设材质与恒定世界主光方向，严禁出现任何人物或动物，无文字、无水印。',
    en: 'Location design sheet (S-class empty environment card): cinematic wide establishing shot of this place, clearly showing architectural layout, depth perspective, key set dressing materials and constant world key-light direction, strictly no people or animals, no text, no watermark.'
  },
  prop: {
    zh: '道具设定图（D级多角度资产卡）：单个核心道具居中，正面、侧面与局部微距细节三角度并排，纯白/纯浅灰无缝背景，影棚级轮廓光，清晰展示器型结构、材质纹理与时代磨损细节，无人物手部入画，无文字、无水印。',
    en: 'Prop design sheet (D-class multi-angle asset card): single key prop centered, front, side and macro detail views side by side, seamless plain light-grey studio background, rim lighting, clearly showing shape, material texture and wear details, no hands or people, no text, no watermark.'
  },
  style: {
    zh: 'STYLE01 全剧视觉风格定调图：电影级黄金构图代表性空镜或氛围剪影，确立全剧核心色彩母题、主光反差比、空气介质颗粒感与材质渲染基准，无文字、无水印。',
    en: 'STYLE01 Master Visual Style Anchor Card: cinematic representative atmosphere frame establishing the show palette, key-to-fill contrast ratio, atmospheric particles and material rendering benchmark; no text, no watermark.'
  },
  vfx: {
    zh: 'FX级特效资产卡：纯黑背景（#000000）居中展示单一能量/法术/光效形态，边缘发光层次与粒子轨迹清晰，便于后期叠加合成，无人物、无场景杂物、无文字、无水印。',
    en: 'FX-class VFX Asset Card: pure black background (#000000) with centered energy/spell/particle effect, clean glowing edges and particle trails ready for compositing, no people, no clutter, no text, no watermark.'
  }
}

/**
 * 组装 AI 漫剧阶段 2 工业级资产卡生成提示词（自动注入 21 题材专属前缀、身高锚点、神秘背影卡规则与反网红整容脸负面词）。
 */
export function buildManjuCastCardPrompt(
  entry: FilmCastEntry,
  cast: FilmCast,
  locale?: string,
  options?: {
    genreId?: string | null
    variantRefLine?: string
    extra?: string
  }
): string {
  const en = (locale ?? '').toLowerCase().startsWith('en')
  const spec = getManjuGenreSpec(options?.genreId)

  if (entry.kind === 'style') {
    if (spec) {
      return buildManjuStyleAnchorPrompt(spec, entry.description || cast.style)
    }
    return [
      pickFilmPrompt(FILM_CAST_IMAGE.style, locale),
      cast.style ? (en ? `Visual style: ${cast.style}` : `视觉风格：${cast.style}`) : '',
      entry.description || '',
      options?.extra || ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  const isBackViewCard =
    entry.stateCode === '背影卡' ||
    /背影卡|神秘背影|back[\s_-]*view/i.test(`${entry.name} ${entry.description}`)

  const genrePrefix = spec
    ? entry.kind === 'character'
      ? en
        ? spec.characterPromptPrefixEn
        : spec.characterPromptPrefixZh
      : entry.kind === 'location'
        ? en
          ? spec.scenePromptPrefixEn
          : spec.scenePromptPrefixZh
        : entry.kind === 'prop'
          ? en
            ? spec.propPromptPrefixEn
            : spec.propPromptPrefixZh
          : ''
    : ''

  const baseSheetLine = isBackViewCard
    ? en
      ? 'Mystery Character Back-View Asset Card: full-body rear view + 3/4 rear silhouette view on plain light-grey background, strictly hiding facial features (face in deep shadow, mask, or turned away), locking silhouette, hair back profile, height proportion and signature cloak/outfit.'
      : '神秘角色背影资产卡（未揭面阶段专用）：纯浅灰无缝背景，展示背面全身与侧后方45°剪影双视图，严禁露出正脸五官（面部处于深阴影、面具遮挡或完全背对镜头），重点锁定身形比例、发式背面轮廓与标志性衣袍配饰；无文字、无水印。'
    : pickFilmPrompt(FILM_CAST_IMAGE[entry.kind] ?? FILM_CAST_IMAGE.character, locale)

  const codeTag = entry.code ? `[${entry.code}] ` : ''
  const heightTag =
    entry.kind === 'character' && entry.heightCm
      ? en
        ? `Height: ${entry.heightCm}cm`
        : `身高：${entry.heightCm}cm`
      : ''
  const dimTag = entry.dimensions?.trim()
    ? en
      ? `Dimensions: ${entry.dimensions.trim()}`
      : `尺寸规格：${entry.dimensions.trim()}`
    : ''
  const lightTag =
    entry.kind === 'location' && entry.worldLightDirection?.trim()
      ? en
        ? `World Key Light: ${entry.worldLightDirection.trim()}`
        : `固定世界主光：${entry.worldLightDirection.trim()}`
      : ''
  const anchorsText = entry.consistencyAnchors?.filter(Boolean).join(en ? ', ' : '、') ?? ''
  const anchorTag = anchorsText
    ? en
      ? `Consistency Anchors: ${anchorsText}`
      : `一致性硬锚点：${anchorsText}`
    : ''

  const negPrompt = spec
    ? en
      ? spec.characterNegativePromptEn
      : spec.characterNegativePromptZh
    : ''
  const negativeLine =
    entry.kind === 'character' && negPrompt
      ? en
        ? `Negative constraints: ${negPrompt}`
        : `负面约束（严禁出现）：${negPrompt}`
      : ''

  return [
    genrePrefix,
    cast.style ? (en ? `Visual style: ${cast.style}` : `视觉风格：${cast.style}`) : '',
    baseSheetLine,
    options?.variantRefLine || '',
    [
      `${codeTag}${entry.name}${entry.description ? `：${entry.description}` : ''}`,
      heightTag,
      dimTag,
      lightTag,
      anchorTag
    ]
      .filter(Boolean)
      .join('；'),
    negativeLine,
    options?.extra || ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** 关键帧视觉质检（vision） */
export const FILM_FRAME_QC_SYSTEM: FilmPromptPack = {
  zh: `你是影视与 AI 漫剧美术质检导演。对照镜头要求检查这张关键帧（若附带设定图，第一张是关键帧，其余是角色/场景/道具设定图）。
检查：
1. 出场人数、角色身份、面部骨相与服装配饰是否与设定图严格一致（女性角色严禁崩坏为网红锥子脸或塑料假脸）；
2. 景别（shotSize）、焦段透视、机位角度与人物左右站位（180°轴线）是否符合本镜要求；
3. 首帧定格姿态与微表情是否准确（内心独白/画外音镜头人物嘴唇必须闭合）；
4. 主光方向是否与本场固定世界主光一致；
5. 是否出现文字、字幕、水印、多格拼图、多余肢体或时代穿帮物件。
只输出 JSON：{ "pass": true|false, "issues": "不通过时写具体问题与重拍修正要点" }`,
  en: `You are a film and AI short-drama art QC director. Check this keyframe against the shot spec (if design sheets are attached, the first image is the keyframe, the rest are character/location/prop sheets).
Check:
1. Correct number of people, identities, facial bone structure, and outfits matching the design sheets;
2. Shot size, focal perspective, camera angle, and left/right 180° axis placement;
3. Frozen pose and micro-expression accuracy (lips must be closed on inner-monologue/voiceover shots);
4. Key-light direction consistent with the scene's world light;
5. No text, subtitles, watermark, split panels, broken anatomy, or anachronistic props.
Output JSON only: { "pass": true|false, "issues": "when failing, concrete problems and reshoot fixes" }`
}
