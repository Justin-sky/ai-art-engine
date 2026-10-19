<div align="center">

<a href="https://justin-sky.github.io/ai-art-engine/index.en.html">
  <img src="docs/assets/banner.webp" alt="AI Art Engine" width="780" height="330" />
</a>

<h1>AI Art Engine</h1>

<p>
  <b>The Agent-Native Multimodal AI Art & Film Production Engine</b><br />
  <sub>Conversational Full-Workspace Control · Typed DAG Node Graph · 10+ Dedicated Dive Workbenches · 3D Rig Director Stage · NLE Multi-Track Timeline · 30+ BYOK Models (Local-First)</sub>
</p>

<p>
  <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/v/release/Justin-sky/ai-art-engine?include_prereleases&style=flat-square&labelColor=0d1117&color=5b8cff&label=release" alt="release" /></a>
  <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/downloads/Justin-sky/ai-art-engine/total?style=flat-square&labelColor=0d1117&color=8b5cf6" alt="downloads" /></a>
  <a href="https://github.com/Justin-sky/ai-art-engine/stargazers"><img src="https://img.shields.io/github/stars/Justin-sky/ai-art-engine?style=flat-square&labelColor=0d1117&color=f5b301" alt="stars" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-22d3ee?style=flat-square&labelColor=0d1117" alt="license" /></a>
  <img src="https://img.shields.io/badge/MCP-Native%20%2B%20Blender-10b981?style=flat-square&labelColor=0d1117" alt="MCP Native" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-64748b?style=flat-square&labelColor=0d1117" alt="platform" />
</p>

<p>
  <a href="https://justin-sky.github.io/ai-art-engine/index.en.html"><b>🌐 Website</b></a> ·
  <a href="https://justin-sky.github.io/ai-art-engine/quickstart.en.html"><b>🚀 Quickstart</b></a> ·
  <a href="https://justin-sky.github.io/ai-art-engine/manual.en.html"><b>📖 Manual</b></a> ·
  <a href="https://space.bilibili.com/3707036976024122"><b>🎬 Video Tutorials</b></a> ·
  <a href="https://github.com/Justin-sky/ai-art-engine/releases"><b>⬇️ Download</b></a> ·
  <a href="./CHANGELOG.md"><b>📝 Changelog</b></a> ·
  <a href="./README.md"><b>中文</b></a>
</p>

</div>

---

## ✨ Why AI Art Engine?

Most AI creative tools are trapped at two extremes: **either a chat-only prompt box** (great for one-off generations, impossible for structured production or fine-grained control) **or an intimidating spaghetti node graph** (steep learning curve with hundreds of cryptic parameters).

**AI Art Engine unifies an industrial-grade visual studio with a 100% Agent-controllable workspace**:

- 🗣️ **Conversational Everything**: Every manual UI action—adding/wiring nodes, diving into specialized sub-editors, tweaking any deeply nested Inspector parameter, or posing 56 humanoid bones, lights, and cameras on the 3D Director Stage—**can be executed directly through natural language in the AI Chat**. Beginners can produce studio-quality work without memorizing node types or parameters.
- 🧩 **End-to-End Production Pipeline**: Combines **Script Breakdown → Character/Scene LookDev → 3D Director Stage Previz → Multimodal DAG Execution (Image / Video / Voice / SFX / Music / 3D / Gaussian Splatting Worlds / Playable HTML5 Games) → NLE Multi-Track Timeline Editing** inside a single desktop project.
- 🔒 **Local-First & BYOK (Zero Lock-in)**: Connect 30+ cloud model providers alongside local ComfyUI / Ollama / NewAPI gateways. Your project is a plain folder of human-readable JSON and media files on disk—no cloud relay, no vendor lock-in.

---

## 🔥 6 Core Engineering & Architectural Highlights

### 1. 4-Pillar Universal Workspace Control & Zero-Config Runtime Introspection

To eliminate the classic disconnect where new UI features or node parameters require manual Agent tool glue code, AI Art Engine introduces a **4-Pillar Universal Workspace Control** architecture:

- **Pillar 1 · Zero-Config Runtime Introspection Engine ([`introspection.ts`](./src/shared/graph/introspection.ts))**: Automatically reflects every registered node's `defaultParams()` and live instance at runtime to construct complete field trees, enum constraints, unambiguous top-level shorthand maps (`shorthandMap`), and available presets. **Register a new node or add a parameter in code, and the AI adapts automatically with zero configuration.**
- **Pillar 2 · Deep Dot-Path & Fuzzy Alias Smart-Patch Engine ([`smartPatch.ts`](./src/shared/graph/smartPatch.ts))**: Supports deep dot-paths and array key-value selectors (e.g., `filmStoryboard.shots[index=2].action`, `filmCast.characters[name=Lin].outfit`, `comicPage.panels[0].caption`), transparently unmarshals/patches/re-serializes JSON-string sub-documents without clobbering sibling fields, heals `snake_case` & bilingual colloquial aliases, and auto-syncs derived prompts.
- **Pillar 3 · Universal Graph, Group & Preset Edit Protocol ([`mcpGraphEdit.ts`](./src/shared/graph/mcpGraphEdit.ts))**: Atomic batch operations covering node CRUD, type-checked port wiring, node groups (`group_add/update/delete`), node geometry/locks (`x/y/w/h/locked`), one-click presets (`apply_preset`), and topological `auto_layout`.
- **Pillar 4 · Focus-Aware Surface Bus ([`surfaceRegistry.ts`](./src/renderer/src/editor/control/surfaceRegistry.ts))**: Tracks open canvases, the active Dive stack, 3D Director Stage state, and current selection—**injecting the focused node's live editable schema on demand** and auto-binding omitted `assetId/nodeId` targets to what the user is currently viewing.

### 2. Dual-Engine Agent Runtime & Bi-Directional MCP Topology (with Blender Direct Bridge)

- **Unified In-App & External Agent Tooling**: The built-in `◈` AI Chat (powered by DeepSeek Harness) and external coding agents (**Claude Code, Codex, Cursor**) share the exact same local `127.0.0.1` MCP tool server over zero-dependency `stdio` bridge or `HTTP Bearer` transport.
- **Hard Request-Level Mode Gates (`Ask / Plan / Craft`)**: Enforced at the protocol layer via `X-AIArt-Mode` headers—`Ask` disables all tool calls, `Plan` restricts to read-only tools until user approval, and `Craft` unlocks full creation/editing, with every call logged to `<userData>/logs/mcp-audit.jsonl`.
- **Zero-Dependency Blender MCP Outbound Bridge (`/mcp/blender`)**: Connects directly to a running Blender instance (supporting both community `blender-mcp` and official Blender Lab MCP extensions) without `uv` or extra Python subprocesses—run `bpy` modeling scripts, inspect shader nodes, grab viewport screenshots, and import GLB assets in one conversational loop.

### 3. Strongly-Typed Multimodal DAG Graph & 10+ Dedicated Dive Workbenches

Double-click any specialized node on the graph to **Dive** into a dedicated full-screen workbench:

- 🎬 **All-in-One Film Workbench (`film.workbench`)**: Script Breakdown → AI Director Review → Character/Location/Prop Cast Library (with `#variant` inheritance) → Batch Keyframe & Auto-Duration Video Shoot, plus per-shot `film.shot` overrides.
- 🖼️ **10-in-1 Image Processing Workbench (`image.process`)**: Crop, Transform, Smart Compose, Grid Split, Local Chroma Cutout, AI Semantic Matte, Erase, Redraw, Expand, and Upscale in a single node.
- ✨ **Non-Destructive Portrait Retouch v2 (`image.portrait`) + Local ONNX Vision**: Powered by local WebWorker **YOLO Detection/Segmentation/Pose** and a **two-stage facial landmark model**, gating retouch groups (`face / mask / pose`) across skin texture, facial sculpting, catchlights, makeup, body reshape, relighting, and ID photo specs.
- 💡 **3D Multi-Angle Camera (`image.multiAngle`), Spherical Relighting (`image.lighting`) & 5×5 Emotion Compass (`image.emotion`)**: Real-time 3D interactive widgets bi-directionally synced with model prompts.
- 📖 **Comic Page Layout Workbench (`comic.page`)**: Diagonal panel slicing, manga speed/focus lines, halftone filters, multi-shape vector speech bubbles, and RTL vertical typesetting.
- 🦴 **2D Rig Stage & Spine Exporter (`stage.2d` / `anim.2d` / `frame.animGen`)**: Hierarchical bone rigging, IK solvers, keyframe baking, and one-click export to **Spine packages (`skeleton.json` + `.atlas` + transparent part atlases)** or stabilized GIFs.

### 4. 3D Director Stage & Cinemachine Storyboard Previz

- **Full 3D Virtual Stage**: Load GLB/GLTF/OBJ/FBX/VRM assets alongside **3D Gaussian Splatting (`.spz` / `.ply` World Labs Marble)** environments.
- **56-Bone Humanoid Rig & Facial Expression Control**: 25+ full-body posture presets, hand & gaze presets, and per-bone Euler rotation (`leftUpperArm`, `head`, `spine`, etc.).
- **AI Blocking & Procedural White-Model Builder ([`directorWhiteModelBuilder.ts`](./src/renderer/src/features/director/directorWhiteModelBuilder.ts))**: Automatically computes multi-actor blocking, furniture/desk surface placement (`y=0.74m`), multi-part geometric white-models, and **Cinemachine camera cut & motion tracks**, capturing previz keyframes or videos directly into storyboard shots.

### 5. Zero-Asset Playable HTML5 Game Compiler + Headless Smoke Gate

- **Procedural Playable Games (`gamePlay`)**: Agents author 2D/3D playable games using 100% procedural geometry, Canvas textures, WebAudio synth SFX, and seeded levels, bundled by the host via `esbuild` into a self-contained `dist/single.html`.
- **Automated Headless Smoke Gate ([`gamePlaySmokeService.ts`](./src/main/services/gamePlaySmokeService.ts))**: Runs the built game in a hidden Chromium window for 3 seconds, sampling 5 frames to verify zero runtime exceptions, non-black luminance, and active frame progression before reporting back to the Agent.

### 6. Unity-Style Editor Kernel & Atomic Local Asset Pipeline

- **Cordis IoC Micro-Kernel ([`src/renderer/src/editor/kernel`](./src/renderer/src/editor/kernel))**: Unified Selection, document-scoped Command Undo/Redo stacks, shadow autosave recovery, and declarative extension points.
- **Atomic Persistence & Cross-Project Packaging**: Temp-file + atomic `rename` JSON writes, `{ $type: "AssetRef", guid }` dependency tracking, `.aipackage` portable bundles, and one-click Marketplace workflow publishing.

---

## 💬 "Speak to Create": Conversational Control Showcase

Whether you are on the node graph or dived inside a specialized editor, just speak naturally in the **◈ AI Chat**:

| Active View                | What You Say to the AI…                                                                                                                          | What the Engine Executes Automatically                                                                                                                                        |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3D Director Stage Dive** | _"Hide Lin Xiaoman, set the key light to warm orange at intensity 2.5, raise the hero's left upper arm by 45° and make him look at the camera."_ | Resolves the active stage host, calls `director_stage_edit` to hide the actor, update light color/intensity, rotate `leftUpperArm`, and apply gaze preset.                    |
| **Portrait Retouch Dive**  | _"Set skin smoothing to strong, face slimming to medium, add catchlights."_                                                                      | Auto-binds to the dived node; `smartPatch` routes aliases to `portraitRetouch.skinSmoothing='strong'`, `faceSlim='standard'`, `catchlight='strong'` and updates the prompt.   |
| **Lighting / Camera Dive** | _"Apply Rembrandt lighting, rotate yaw to 45°, and enable rim light."_                                                                           | Applies the `rembrandt` preset, merges `lightingSetup.yaw=45` & `rimLight=true`, and syncs the 3D light gizmo and `lightingPrompt`.                                           |
| **Film Workbench Dive**    | _"Change Shot 2's sound to rapid footsteps and thunder, and change Lin's outfit to a black techwear trench coat."_                               | Transparently unmarshals `filmStoryboard` & `filmCast` JSON strings, patches `shots[index=2].sound` and `entries[name=Lin].description`, and re-serializes without data loss. |
| **Comic Page Dive**        | _"Set reading order to right-to-left manga style and change Panel 1's title to 'Dawn'."_                                                         | Updates `comicPage.readingDirection='rtl'` and `comicPage.panels[0].title` while preserving all other panels and speech bubbles.                                              |
| **Node Graph Canvas**      | _"Add a lighting node connected to a portrait retouch node, group them as 'Retouch Pipeline', and auto-layout."_                                 | Executes `node_add` + `edge_add` + `group_add` + `auto_layout` in a single atomic batch with Undo/Redo support.                                                               |

---

## 🚀 Getting Started

Download the installer from [GitHub Releases](https://github.com/Justin-sky/ai-art-engine/releases) (Windows `.exe`, macOS `.dmg` `arm64`/`x64`, Linux `.AppImage`):

1. Open **Settings → Models**, add a provider, and enter your API Key.
2. Create a project and select **New → One-Click Workflow** in the workspace to generate your first canvas.
3. Open the **◈ AI Chat** on the left, `@`-reference assets, or double-click any node to Dive in and control every parameter by voice/text!

See the [Quickstart Guide](https://justin-sky.github.io/ai-art-engine/quickstart.en.html) and [User Manual](https://justin-sky.github.io/ai-art-engine/manual.en.html) for the full walkthrough.

---

## 🔌 Connect External Agents (Claude Code / Codex / Blender)

```bash
# Option A: stdio bridge (requires Node.js 18+)
claude mcp add aiartengine -- node <install-or-repo-dir>/scripts/mcp-bridge.mjs

# Option B: Direct HTTP (endpoint and token under Settings → MCP)
claude mcp add --transport http aiartengine http://127.0.0.1:43110/mcp \
  --header "Authorization: Bearer <token>"

# Optional: Connect the Blender MCP toolset
claude mcp add --transport http blender http://127.0.0.1:43110/mcp/blender \
  --header "Authorization: Bearer <token>"
```

Full tool reference and security model: [`docs/MCP.md`](./docs/MCP.md).

---

## 🛠️ Build from Source

Requires **Node.js 22+**.

```bash
git clone https://github.com/Justin-sky/ai-art-engine.git
cd ai-art-engine
npm install
npm run dev
```

Architecture & extension guides: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · [`docs/GRAPH_PLUGINS.md`](./docs/GRAPH_PLUGINS.md) · [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## 🤝 Community & License

GitHub is the primary repository and [Gitee](https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine) is a synchronized mirror.

<a href="https://github.com/Justin-sky/ai-art-engine/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Justin-sky/ai-art-engine" alt="contributors" />
</a>

- **QQ Groups**: `346340389` · `647306826` ｜ [Bilibili](https://space.bilibili.com/3707036976024122) ｜ [X @IoKKFOvWAt12669](https://x.com/IoKKFOvWAt12669) ｜ [284139554@qq.com](mailto:284139554@qq.com)
- **License**: [GPL-3.0](./LICENSE)
