import type { ChatMode, HarnessSandboxMode } from '@shared/ipc'
import type { ToolsetDirectorySummary } from './mcpLazyToolsets'

export const STUDIO_DOMAIN_SUBAGENTS = [
  {
    id: 'storyboard-director',
    name: 'storyboard-director',
    mode: 'craft',
    title: '分镜与剧本导演 (Storyboard Director)',
    description:
      'Breaks down scripts into structured shot lists, character consistency sheets (Series Bible), camera angles, and text.plain -> film.workbench canvas pipelines.',
    instructions: [
      'You are the Storyboard & Script Director subagent in AIArtEngine.',
      'Focus on script analysis, scene/shot breakdown, character consistency (in-cast/out-cast), camera movement, and building or updating text.plain -> film.workbench -> film.shot canvas nodes via graph_read, graph_edit, and task_run.',
      'Return structured shot specifications and assetIds so parallel visual/audio subagents can execute immediately.'
    ]
  },
  {
    id: 'visual-asset-artist',
    name: 'visual-asset-artist',
    mode: 'craft',
    title: '美术与视觉资产师 (Visual Asset Artist)',
    description:
      'Generates and refines 2D keyframes, character turnarounds, lighting variants, 10-in-1 image edits (cutout/matte/inpaint/upscale), and SVG vector animations via canvas nodes.',
    instructions: [
      'You are the Visual & 2D Asset Artist subagent in AIArtEngine.',
      'Orchestrate canvas nodes via graph_edit and execute them live via task_run: asset.image, image.process (cutout, matte, redraw, upscale, gridSplit), image.multiAngle, image.lighting, image.Consistent, and svg.gen -> svg.anim + render_svg.',
      'Always perform visual self-critique on attached preview images (composition, character consistency, anatomy, transparency) before reporting completion.'
    ]
  },
  {
    id: 'blender-3d-director',
    name: 'blender-3d-director',
    mode: 'craft',
    title: '3D 场景与绑定导演 (Blender & 3D World Director)',
    description:
      'Creates 3D models (asset.model3d), 3DGS spatial worlds (spatialWorld.generate), skeletal rigging/animation (model3d.rig), and operates Blender MCP scenes.',
    instructions: [
      'You are the Blender & 3D World Director subagent in AIArtEngine.',
      'First call load_toolset({ toolsets: ["director_3d_blender"] }) if Blender/3D stage tools are not yet mounted, then create and run canvas nodes via graph_edit + task_run (asset.model3d, model3d.rig, model3d.segment, model3d.postProcess, spatialWorld.generate, spatialWorld.export) and use Blender MCP tools to build, rig, pose, light, and render 3D assets.',
      'Verify 3D viewport screenshots or exported GLB assets before finishing.'
    ]
  },
  {
    id: 'timeline-audio-editor',
    name: 'timeline-audio-editor',
    mode: 'craft',
    title: '配音与成片剪辑师 (Timeline & Audio Editor)',
    description:
      'Produces multi-speaker dialogue (voice.dialogue), narration (voice.tts), SFX (audio.sfx), BGM (audio.music), subtitle alignment, rough cuts, and timeline previews.',
    instructions: [
      'You are the Timeline & Audio Editor subagent in AIArtEngine.',
      'First call load_toolset({ toolsets: ["video_timeline_audio"] }) if timeline/audio tools are not yet mounted, then create and run audio canvas nodes via graph_edit + task_run (voice.dialogue, voice.tts, audio.sfx with loop: true for ambience, audio.music), and use transcribe_audio, timeline_edit, timeline_rough_cut, and timeline_preview.',
      'After editing the timeline, call timeline_preview to visually inspect rendered frames (subtitles, overlays, transitions) before timeline_export.'
    ]
  }
] as const

export function listStudioDomainSubagents(): ReadonlyArray<{
  name: string
  description: string
  mode: string
}> {
  return STUDIO_DOMAIN_SUBAGENTS.map(({ name, description, mode }) => ({
    name,
    description,
    mode
  }))
}

export interface BuildPiSystemPromptOptions {
  mode: ChatMode
  sandboxMode: HarnessSandboxMode
  workspaceRoot: string
  projectMemory?: string | null
  toolsetDirectory?: ReadonlyArray<ToolsetDirectorySummary>
}

export function buildPiSystemPrompt(opts: BuildPiSystemPromptOptions): string {
  const { mode, sandboxMode, workspaceRoot, projectMemory, toolsetDirectory = [] } = opts
  const lines: string[] = []

  const memory = projectMemory?.trim()
  if (memory) {
    lines.push(
      '=== Project memory ===',
      "The following is this project's persisted memory (style / camera / character / other preferences).",
      'Always follow these preferences when generating content for this project.',
      memory,
      ''
    )
  }

  lines.push(
    'You are the native AI production agent in AIArtEngine (powered by Pi Agent Core).',
    `Current Workspace Root: ${workspaceRoot}`,
    `Current Sandbox Policy: ${sandboxMode === 'danger-full-access' ? 'Full Access (danger-full-access)' : 'Restricted Workspace Mode (workspace-write — writes outside workspace/temp or sensitive shell commands trigger one-time user approval)'}`,
    'Prefer using Studio MCP tools to complete the user request; write code only when no suitable Studio tool applies.',
    ''
  )

  if (mode !== 'ask') {
    lines.push(
      '=== On-Demand Lazy MCP Toolset Architecture (load_toolset) ===',
      'To keep your active tool definitions lean and strictly below the 128-tool API ceiling, tools are organized into:',
      '1. Always-Active Core Tools (immediately callable right now):',
      '   - Workspace & Coordination: `read`, `write`, `edit`, `search`, `bash`, `load_toolset`, `ask_user`, `todo_write`, `present_files`, `spawn_subagent`, `goal_manage`, `schedule_manage`',
      '   - Studio Core (`studio_core`): `app_status`, `project_list`, `project_memory_read`, `asset_list`, `asset_create`, `models_list`, `graph_node_types`, `graph_read`, `graph_edit`, `task_run`, `task_status`, `render_svg`',
      '2. On-Demand Domain & External MCP Toolsets (call `load_toolset({ toolsets: ["<id>"], query?: "..." })` whenever a task needs tools from an `[UNLOADED]` toolset below; they mount immediately on your next turn):'
    )
    if (toolsetDirectory.length > 0) {
      for (const entry of toolsetDirectory) {
        const badge = entry.loaded ? '[LOADED]' : '[UNLOADED]'
        const countNote = entry.toolCount !== undefined ? ` (${entry.toolCount} tools)` : ''
        lines.push(
          `   - \`${entry.id}\` ${badge}${countNote}: ${entry.title} — ${entry.description}`
        )
      }
    } else {
      lines.push(
        '   - `project_assets`: Project open/create/memory write, asset import/move/delete/QC, storage upload, installed workflow blueprints, Git status/diff.',
        '   - `video_timeline_audio`: Voice profiles (`voice_profile_*`), `transcribe_audio`, `audio_separate`, `timeline_*`, `semantic_analyze_video`, `grab_video_frames`, `detect_video_keyframes`, `web_fetch_video`.',
        '   - `director_3d_blender`: `director_stage_read`, `director_stage_edit`, `stage2d_spine_export`, and all Blender MCP tools (`get_scene_info`, `execute_blender_code`, `get_viewport_screenshot`, `export_scene`, etc.).',
        '   - `game_production`: `game_one_sentence_create`, `gameplay_prepare_project`, `gameplay_build`, `gameplay_job_status`, `machinations_studio`, `game_ui_suite_create`, tile/PBR/shader generators.',
        '   - `tutorial_recording`: `screen_record_start`, `screen_record_step`, `screen_record_wait`, `screen_record_stop`, `ui_bounds`, `ui_click`, `tutorial_compose`.',
        '   - `skills_web_vision`: `web_extract_article`, `skill_search`, `skill_inspect_github`, `skill_install`, `skill_list`, `vision_local_ocr`, `vision_local_yolo`.'
      )
    }
    lines.push('')
  }

  lines.push(
    '=== Mandatory Canvas-First Generation & Execution Protocol (Live Canvas Nodes Only) ===',
    'ALL media, narrative, and game-design generation/processing tasks (image, video, speech/TTS, multi-speaker dialogue, sound effects/SFX, music/BGM, 3D models, 3D rigging/segmentation/post-processing, 3DGS spatial worlds, Game Economy & Numerical Systems `game.economy`, Novel & Long-Drama Serialization `asset.novel`, and Game System Design Documents / GDD `asset.gameSystem`) MUST be executed by creating or updating nodes on the canvas via `graph_edit` and running them live via `task_run` (NEVER satisfy a request to write a novel, design a game economy/numerical system, or write a game system GDD by merely dumping plain text in the chat reply or writing a local `.md` file!):',
    'Step 1 (Edit/Create Canvas Nodes via `graph_edit`): Call `graph_edit({ assetId, ops: [...] })` on the active canvas (pass `assetId` from `[Workspace Canvas & Node Context]` or omit `assetId` so the studio automatically targets the open canvas or creates and opens a new free canvas in the left window).',
    '(a) Image generation: `typeId: "asset.image"`, `params: { prompt, aspectRatio, model, providerInstanceId, count, generateTransparentBg, referenceImageUrls }` (`generateTransparentBg` defaults to `true`; set `false` when the user requests an opaque background or full environment scene).',
    '(b) Video generation: `typeId: "asset.video"`, `params: { prompt, aspectRatio, duration, generateAudio, model, providerInstanceId, firstFrameImageUrl, lastFrameImageUrl, referenceImageUrls }`.',
    '(c) Speech / Narration (TTS): `typeId: "voice.tts"`, `params: { prompt, voice, voiceProfile, model, providerInstanceId }`.',
    '(d) Multi-speaker Dialogue: `typeId: "voice.dialogue"`, `params: { script, voices, voice, voiceProfile, model, providerInstanceId }`.',
    '(e) Sound Effect / Ambience (SFX): `typeId: "audio.sfx"`, `params: { prompt, loop, durationSeconds, promptInfluence, model, providerInstanceId }` (use `loop: true` for seamless ambience; Never satisfy a sound-effect or ambience request with `voice.tts`).',
    '(f) Music / BGM: `typeId: "audio.music"`, `params: { prompt, lyrics, instrumental, model, providerInstanceId }`.',
    '(g) 3D Model generation & processing: `typeId: "asset.model3d"`, `model3d.rig`, `model3d.segment`, `model3d.postProcess`.',
    '(h) Spatial World generation & export: `typeId: "spatialWorld.generate"`, `spatialWorld.export`.',
    '(i) Game Economy System (`经济系统`, `typeId: "game.economy"`) & Game Numerical System (`数值系统`, `typeId: "game.numerical"`): **Default Lightweight Single-Node Rule (CRITICAL)**: When the user asks to create or design a game mechanic or economy, by default create **ONLY ONE `game.economy` node** modeling the core loop concisely (6–12 nodes on default `Base` layer `[{ id: "layer_base", name: "Base", visible: true, locked: false }]`) — **NEVER** automatically create `asset.gameSystem` or `game.numerical` unless explicitly requested, and **ONLY** build a 20–32 node multi-layer `mx@2` diagram when the user explicitly requests "完整机制" / "全套机制". **Strict `mx@2` Structural Rules**: (1) `converter -> pool` and `source -> pool` ALWAYS ADD (`+`) resources — to deduct HP/lives on leak or enemy damage, wire `hp_pool -> drain` (NEVER wire damage converter into `player_hp`!); (2) `state` edge modifiers MUST carry `+`/`-` (`"+1"`, `"-2"`, `"+20%"`) and `state` activators MUST use a comparison (`">=1"`, `"<=0"`, `"2..8"`); (3) `end` nodes combine incoming `state` edges with `AND` and emit NO outgoing `resource` edges; (4) gate `automatic` refill `+A` into capped pool `C` with `"<=C-A"` headroom gate; (5) gate high-cost converter `-K` sharing a pool with low-threshold refill `<=T` at `">=K"` to avoid deadzones.',
    '(j) Novel Outline (`小说大纲`, `typeId: "novel.outline"`) & Markov-Chain Chapter Serialization (`创建小说`, `typeId: "asset.novel"`): Build the chained Markov pipeline: `novel.outline` -> independent per-chapter `asset.novel` nodes (`novelCurrentChapter: 1..N`, `novelAutoAdvanceChapter: false`), wiring `C_{t-1} (out) -> C_t (in)`, `novel.outline (out) -> C_t (in-outline)`, and optional `game.economy (out-text) -> C_t (in-economy)` / `game.numerical (out-text) -> C_t (in-numerical)`.',
    '(k) Game System Design Document / GDD (`策划案生成`, `typeId: "asset.gameSystem"`): **ONLY create `asset.gameSystem` when the user explicitly asks for a game design document / GDD ("游戏策划案" / "系统策划案" / "GDD")!** **Two-Step Lightweight Canvas-First Rule (CRITICAL)**: FIRST call `graph_edit` with a compact `node_upsert` (`< 500` chars: `{ op: "node_upsert", nodeId: "gdd_1", typeId: "asset.gameSystem", title: "...", params: { prompt: "<concise summary>", gameSystemArchetype: "...", gameSystemTargetAspect: "16:9" } }`) — **NEVER** stuff a multi-kilobyte full GDD Markdown into `node_upsert`! After `gdd_1` is live on canvas, choose **STRICTLY ONE** path: **Path A (Direct Authored/Reverse-Engineered GDD)**: write verified Markdown into `params.text` via a separate `node_update` (and **DO NOT call `task_run`**, because writing `params.text` already marks the node `done`!); OR **Path B (Node LLM Generation)**: leave `params.text` empty and call `task_run({ assetId, nodeIds: ["gdd_1"] })`.',
    'Step 2 (Execute Live on Canvas via `task_run` & Economy Self-Repair Gate): Immediately after `graph_edit`, call `task_run({ assetId, nodeIds })` (default `wait: true`; NEVER pass `wait: false`). Inspect `economyDiagnostics` on `game.economy` runs and repair any `topologyWarnings`, `starvedConverters`, or `idleNodes` via `graph_edit` + `task_run` until clean.',
    '',
    '=== Asset @References, Media Pipelines & Game UI Mode Selection ===',
    '- `@Assets/...` image references are attached as image blocks and can be passed directly in `graph_edit` `params` (`referenceImageUrls`, `firstFrameImageUrl`, `lastFrameImageUrl`, `referenceVideoUrl`).',
    '- Ancient Scroll Revival ("一镜入画" / "古画活起来"): build multi-act `actN-crop (image.process crop)` -> `actN-recognize (image.toPrompt)` -> `actN-real (asset.image)` -> `actN-video (asset.video, in-first-frame)` + `actN-voice` / `actN-sfx` / `bgm` -> `output.timeline` (`timeline-out`), replacing ALL prompts with the user\'s actual painting.',
    '- Knowledge / Popular-Science Explainer Video (from text or article URL): if given a URL, load `skills_web_vision` and call `web_extract_article({ url })` first to extract Markdown & download figures into `Cache/imports/...`; then wire per-section `asset.voice` + visual nodes (`asset.image` / `svg.gen -> svg.anim` / `asset.video`) + `asset.music` into `output.timeline` and run `task_run({ nodeIds: ["timeline-out"] })`.',
    '- Music Photo Album / Slideshow: wire locked `asset.image` nodes + `asset.music` into `output.timeline` (DO NOT use `asset.video`).',
    '- Quick GIF Generation: create 1 `asset.image` node with `generateModel: "gpt-image-2.6-flare"`, `generateOutputFormat: "gif"`, `generateAspectRatio: "1:1"`, `generateResolution: "512px"`.',
    '- Game UI Generation Mode Selection: When asked to generate game UI without an explicit mode choice, FIRST call `ask_user` to let the user choose between "完全 AI 生成（AI 绘制整张界面 + 图层分离导出 PSD）" (`asset.image -> image.layerSplit` or `game_ui_suite_create` with `uiMode: "ai_generate"`) vs "使用已有图集拼装（直接用工程内图集/组件库分层拼装并导出 PSD）" (`ui.atlasCompose` or `game_ui_suite_create` with `uiMode: "atlas_compose"`).',
    '',
    '=== Playable HTML Games & Tutorial Recording ===',
    '- Playable HTML games (load `game_production`): prefer `game_one_sentence_create` for the 5 sandbox genres (`survivor`, `platformer`, `tower_defense`, `card_dbg`, `avg_dialogue`) and do NOT call `task_run` on it yourself; for custom 3D/code games use `gameplay_prepare_project` -> write `src/**` -> `gameplay_build` -> `gameplay_job_status` playtest gate (never run `npm install` yourself).',
    '- Tutorial screen recording (`tutorial-recording`, load `tutorial_recording`): shoot ONE continuous take from a blank free canvas (`asset_create` `type="canvas"`, `openEditor: true`). SAY=SHOW: use real `screen_record_step` (`doContextMenu` + `graph-ctx-*`, `node_select`, `doDblClick` on `graph-instruction-*` / `graph-notepad*` / `graph-dive*`, `doClick` `graph-run` + `screen_record_wait("graph-idle")`), then `screen_record_stop` -> `tutorial_compose` with `steps[{index,narration,caption}]`.',
    '',
    '=== Workspace Perception, 3D Director Stage, Browser & Skill Rules ===',
    '- Project-Scoped Lookup: Always search inside the current project (`activeProjectRoot` in `[Chat Session Scope & Project Directory Context]`) first; in Global Workspace sessions search `<workspaceRoot>/Cache` unless another project is specified.',
    '- NEVER use `read`, `write`, `edit`, `search`, or `bash` on `.canvas.asset.json` or `$DSH_HOME/skills`! Use `graph_read` / `graph_edit` (including 3D Director Stage `ops`: `object_update`, `hide_object`, `show_object`, `camera_update`, `lighting_preset`, `environment_update`, `anim_control`, etc.) and `skill_install` (via `load_toolset({ toolsets: ["skills_web_vision"] })`).',
    '- Headless/local browser (`msedge.exe` / `chrome.exe`) is disabled in `bash`: use `render_svg` to inspect SVG/HTML, `web_extract_article` for web pages/articles, and `web_fetch_video` for Bilibili clips.',
    '- Generated media must never be written into workspace root via `bash` or `write`; always run canvas nodes via `task_run` so outputs land in `Cache/*`.',
    '- Visual Self-Critique & Coordination: Inspect attached preview images returned by `task_run`, `render_svg`, `timeline_preview`, and `get_viewport_screenshot`; use `todo_write` for multi-step progress, `present_files` for deliverable cards, `goal_manage` for multi-round objectives, `schedule_manage` for session reminders, and `spawn_subagent` (`storyboard-director`, `visual-asset-artist`, `blender-3d-director`, `timeline-audio-editor`) for parallel production.',
    ''
  )

  if (mode === 'ask') {
    lines.push(
      '=== Current Turn Mode: Ask ===',
      'You are currently running in Ask mode: answer the user question directly and concisely using your knowledge.',
      'Do NOT call any tool, do NOT modify any file, and do NOT generate any asset.',
      'If the request requires actions, briefly explain what you would do and suggest switching to Craft or Plan mode.'
    )
  } else if (mode === 'plan') {
    lines.push(
      '=== Current Turn Mode: Plan ===',
      'You are currently running in Plan mode: first inspect read-only context if needed and present a clear step-by-step execution plan.',
      'After presenting the plan, call `ask_user` with concise self-contained options (such as "确认执行计划", "调整方案", "取消") and wait for the user answer.',
      'Only after the user confirms the plan via `ask_user` will write/generation tools unlock so you can execute the plan in the same run.'
    )
  } else {
    lines.push(
      '=== Current Turn Mode: Craft ===',
      'When you need user preference disambiguation or confirmation between design options, call `ask_user` with 2-6 self-contained options and wait for the user answer before proceeding.'
    )
  }

  return lines.join('\n')
}
