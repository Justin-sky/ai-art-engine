<div align="center">

<a href="https://justin-sky.github.io/ai-art-engine/index.en.html">
  <img src="docs/assets/banner.webp" alt="AI Art Engine" width="780" height="330" />
</a>

<h1>AI Art Engine</h1>

<p>
  <b>The Agent-Native AI Game Art & Film Production Engine</b><br />
  <sub>Conversational Full-Workspace Control · Production-Ready PSD / Spine / Engine Code / NLE Drafts · Typed DAG Graph · 100% Local-First</sub>
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

## 💡 Why AI Art Engine?

Most AI creative tools are stuck at two extremes: **either a chat-only prompt box** (producing flat, uneditable images) **or an intimidating spaghetti node graph** (hundreds of cryptic parameters).

**AI Art Engine unites conversational full-workspace control with industrial-grade deliverable export**: direct every canvas, sub-editor, 3D rig, and timeline in plain language, and export files that artists and developers can immediately ship—**layered `.psd` with editable text, Spine 2D rigs, Unity/Godot UI code, and CapCut/Jianying multi-track drafts**.

---

## ✨ 4 Core Highlights

### 1. 📦 Beyond Flat Images: Ship Production-Ready Engineering Files

| Domain                        | Typical AI Tool Output    | **What AI Art Engine Ships**                                                                                                                                                                                                                                                                                                      |
| :---------------------------- | :------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🎮 Game UI Pipeline**       | Flat, uneditable PNG      | Recognizes **16 standard HTML5 / Unity UI Toolkit controls**, splits **button labels (built-in offline/online OCR → native Photoshop `TySh` editable text layers)**, **inpainted 9-slice plates**, and **hover/pressed states** into a **2-level nested `.psd`** + **Unity (`.uxml/.uss`/UGUI) · Godot 4 (`.tscn`) · HTML5** code |
| **🦴 2D Rigging & Animation** | Static art or warpy video | Auto part segmentation, hierarchical bone rigging, IK solvers, and keyframe baking → standard **Spine packages (`skeleton.json` + `.atlas` + transparent part atlases)**                                                                                                                                                          |
| **🎬 AI Film & Drama**        | Disconnected video clips  | Script breakdown → AI Director review → `#variant` character consistency → batch shooting → **MP4** + **CapCut / JianyingPro editable NLE drafts**                                                                                                                                                                                |
| **🎥 3D Previz & Playables**  | No spatial control        | **56-bone 3D Director Stage + 3D Gaussian Splatting + Blender MCP live modeling (`.glb`)** + zero-asset playable **HTML5 games (`single.html`)** verified by headless smoke tests                                                                                                                                                 |

### 2. 🗣️ Chat-Native Studio & Bi-Directional MCP

- **Conversational Everything**: Wiring nodes, tweaking deep Inspector parameters, posing 56 humanoid bones on the 3D Stage, or ripple-cutting silent pauses on the timeline—**every manual UI action can be triggered by a single sentence in the `◈ AI Chat`**.
- **MCP Server + Blender Bridge**: Automatically hosts a local `127.0.0.1` MCP server on launch so **Claude Code, Codex, and Cursor** can drive your project directly, plus a zero-dependency **Blender MCP bridge (`/mcp/blender`)** for live `bpy` modeling and viewport inspection.

### 3. 🧩 Typed Multimodal Node Graph × 10+ Deep-Dive Workbenches

- **Macro Graph, Micro Precision**: Chain Text, Image, Video, Speech, Music, SFX, 3D, and Spatial Worlds on a typed DAG canvas; double-click any specialized node to **Dive** into a full-screen workbench (**Film Workbench, UI Control Layer Split, 10-in-1 Image Studio, Portrait Retouch, 3D Camera & Relighting, Comic Layout, 3D Director Stage**).
- **PNG-as-Workflow**: Exported PNGs embed lightweight graph metadata (`aiae:graph`)—drag any output PNG back onto the canvas to restore the entire node pipeline.

### 4. 🔒 100% Local-First & BYOK (Zero Lock-in)

- **Built-in Offline OCR & Local ONNX Vision**: Ships with cross-platform **native offline OCR (Windows WinRT / macOS Vision / Tesseract)** and local **ONNX Runtime vision (YOLO Detect/Segment/Pose, 468-point Face Landmarks, SAM 2.1)**—zero cloud keys required for UI layer splitting, matting, or facial retouch gating.
- **30+ Cloud & Local Providers**: Bring your own key for OpenRouter, OpenAI, Gemini, DeepSeek, Kling, Volcengine, Meshy, Tripo, World Labs, or local **ComfyUI / Ollama / vLLM**. Projects are plain folders of readable JSON and media files on your disk.

---

## 💬 Speak to Create: Natural Language in Action

| Active View             | What You Say to the AI…                                                                                                    | What the Engine Executes Automatically                                                                                                                              |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UI Layer Split**      | _"Split this RPG inventory screen into standard UI controls as an editable PSD and export Unity UI Toolkit code."_         | Recognizes 16 control types → runs offline/online OCR → inpaints text-free 9-slice plates → exports a nested `.psd` with `TySh` editable text layers + `.uxml/.uss` |
| **3D Director Stage**   | _"Set the key light to warm orange, raise the hero's left upper arm by 45°, look at the camera, and snap a previz frame."_ | Updates 3D light color/intensity, rotates `leftUpperArm`, applies gaze preset, and captures the viewport into the storyboard                                        |
| **Film Workbench**      | _"Change Shot 2's sound to thunder, switch Lin's outfit to a black techwear coat, and reshoot only that shot."_            | Patches Shot 2 and `#variant` lookdev, re-running only the modified shot via fingerprint caching                                                                    |
| **Portrait & Lighting** | _"Apply Rembrandt lighting at 45° yaw, strong skin smoothing, and subtle catchlights."_                                    | Syncs the 3D light sphere, gates facial zones via local ONNX landmarks, and updates derived prompts                                                                 |
| **NLE Timeline**        | _"Cut all silent pauses from the voiceover, lay down subtitles, and export a CapCut draft."_                               | Runs audio transcription → ripple-cuts silence → builds subtitle track → exports MP4 or CapCut/Jianying draft                                                       |

---

## 🚀 Get Started in 3 Minutes

1. **Download**: Grab the installer from [**GitHub Releases**](https://github.com/Justin-sky/ai-art-engine/releases) (Windows `.exe`, macOS `.dmg` `arm64`/`x64`, Linux `.AppImage`).
2. **Try Zero-Key Live Demo**: Create a project, open the **◈ AI Chat**, and click **⚡ Zero-Key Instant Demo** to run structural UI control decomposition and editable PSD export immediately—no API key required.
3. **Connect Models**: Open **Settings → Models** to add your API keys or local ComfyUI / Ollama endpoints.

👉 Read the [**5-Minute Quickstart**](https://justin-sky.github.io/ai-art-engine/quickstart.en.html) and [**User Manual**](https://justin-sky.github.io/ai-art-engine/manual.en.html).

---

## 🔌 Connect External Agents (Claude Code / Codex / Blender)

```bash
# Option A: stdio bridge
claude mcp add aiartengine -- node <install-or-repo-dir>/scripts/mcp-bridge.mjs

# Option B: Direct HTTP (token under Settings → MCP)
claude mcp add --transport http aiartengine http://127.0.0.1:43110/mcp \
  --header "Authorization: Bearer <token>"

# Optional: Built-in Blender MCP modeling bridge
claude mcp add --transport http blender http://127.0.0.1:43110/mcp/blender \
  --header "Authorization: Bearer <token>"
```

---

## 🛠️ Build from Source

Requires **Node.js 22+**.

```bash
git clone https://github.com/Justin-sky/ai-art-engine.git
cd ai-art-engine
npm install
npm run dev     # Start dev mode with hot reload
npm test        # Run unit test suite
npm run build   # Build production packages
```

- **Technical Docs**: [Architecture (`ARCHITECTURE.md`)](./docs/ARCHITECTURE.md) · [MCP Reference (`MCP.md`)](./docs/MCP.md) · [Local Vision & Offline OCR (`ARCH_YOLO_LOCAL.md`)](./docs/ARCH_YOLO_LOCAL.md) · [Graph Plugins (`GRAPH_PLUGINS.md`)](./docs/GRAPH_PLUGINS.md) · [Marketplace Spec (`MARKETPLACE.md`)](./docs/MARKETPLACE.md)

---

## 🤝 Community & License

Contributions are welcome ([`CONTRIBUTING.md`](./CONTRIBUTING.md)). GitHub is the primary repo; [Gitee](https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine) is a synced mirror.

<a href="https://github.com/Justin-sky/ai-art-engine/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Justin-sky/ai-art-engine" alt="contributors" />
</a>

- **QQ Groups**: `346340389` · `647306826` ｜ [Bilibili](https://space.bilibili.com/3707036976024122) ｜ [X @IoKKFOvWAt12669](https://x.com/IoKKFOvWAt12669) ｜ [284139554@qq.com](mailto:284139554@qq.com)
- **License**: [GPL-3.0](./LICENSE)
