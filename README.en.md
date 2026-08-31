<div align="center">
  <img src="docs/assets/logo-mark.png" alt="" width="96" />

  <h1>AI Art Engine</h1>

  <p><b>Professional AI creation tool · short drama · ads · film</b></p>
  <p>
    Local-first projects · Shot & node-graph workflows · Built-in MCP Server drivable by Claude Code and other AI agents<br />
    OpenRouter · OpenAI · DeepSeek · Zhipu · Kimi · xAI · Google · vLLM · Ollama · LM Studio · Volcengine Ark · Kling · MiniMax · Tongyi Qianwen · ModelScope · ComfyUI · Meshy · Tripo · Rodin (Hyper3D) · Luma AI · Lux3D<br />
    Object storage: Volcengine TOS · Alibaba Cloud OSS · Tencent Cloud COS
  </p>

  <p>
    <a href="https://github.com/Justin-sky/ai-art-engine/stargazers"><img src="https://img.shields.io/github/stars/Justin-sky/ai-art-engine?style=social" alt="GitHub stars" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/network/members"><img src="https://img.shields.io/github/forks/Justin-sky/ai-art-engine?style=social" alt="GitHub forks" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/v/release/Justin-sky/ai-art-engine?include_prereleases&label=release&style=flat-square" alt="release" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg?style=flat-square" alt="license" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/blob/main/package.json"><img src="https://img.shields.io/github/package-json/v/Justin-sky/ai-art-engine?label=version&style=flat-square&color=orange" alt="version" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Local--First-00B894?style=for-the-badge" alt="local" />
    <img src="https://img.shields.io/badge/Node_Graph-6C5CE7?style=for-the-badge" alt="graph" />
    <img src="https://img.shields.io/badge/Win%20%7C%20macOS%20%7C%20Linux-0984E3?style=for-the-badge" alt="platform" />
  </p>

  <p>
    <a href="https://justin-sky.github.io/ai-art-engine/index.en.html"><b>Website</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/manual.en.html"><b>Manual</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/guide-video.en.html"><b>Video guide</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/guide-short-video.en.html"><b>Short-video guide</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/guide-comfyui.en.html"><b>ComfyUI guide</b></a> · <a href="https://justin-sky.github.io/ai-art-engine/guide-mcp.en.html"><b>MCP Setup</b></a> ·
    <a href="https://space.bilibili.com/3707036976024122"><b>Video tutorials</b></a> ·
    <a href="https://github.com/Justin-sky/ai-art-engine/releases"><b>Download</b></a> ·
    <a href="#community"><b>Community</b></a> ·
    <a href="#features"><b>Features</b></a> ·
    <a href="#quick-start"><b>Quick Start</b></a> ·
    <a href="./README.md"><b>中文</b></a>
  </p>
</div>

---

<a id="download"></a>

## Download

| Platform | Package | Get it |
|----------|---------|--------|
| **Windows** | `.exe` | [GitHub Releases](https://github.com/Justin-sky/ai-art-engine/releases) |
| **macOS** | `.dmg` | [GitHub Releases](https://github.com/Justin-sky/ai-art-engine/releases) (Mac / CI build; allow in Privacy & Security if unsigned) |
| **Linux** | `.AppImage` | [GitHub Releases](https://github.com/Justin-sky/ai-art-engine/releases) (`chmod +x` then run) |

Push a `v*` tag to trigger GitHub Actions multi-platform builds, or package locally:

```bash
npm run dist:win | dist:mac | dist:linux
```

---

<a id="features"></a>

## Features

**AIArtEngine** is a professional AI creation tool for short drama, ads, and film: assets, shots, and a node graph in one desktop app — local-first projects, your API keys, your files.

### Headline features: AI chat + MCP

> Drive every generation and orchestration capability from an in-app conversation — or let external AI agents such as Claude Code / Codex connect straight to your project.

- **AI chat panel** — in-app AI assistant (DeepSeek Harness runtime): `@`-reference project assets in conversation and let the agent call MCP tools directly — generate image / video / 3D / speech, edit node graphs, run workflows and track status; multi-session history; model picker over any configured text provider  
- **MCP tool server** — built-in MCP Server so external agents like Claude Code / Codex can drive your project over stdio bridge or direct HTTP (plan & commit workflows, run generation, read/write assets and graphs); stable token across restarts, audit log, concurrency gate  

### Full capabilities

- **Local projects** — create / open / recent; JSON + media on disk  
- **One-click workflow** — presets (short-drama storyboard, game UI, game UA, product ad, e-commerce, game 3D assets, comic publishing, knowledge voice-over, 3D blockout…) or AI-planned topology → reusable host asset (boundary I/O + Dive)  
- **Assets** — image / video / audio / 3D model; AssetRef GUIDs; `.aipackage`  
- **Shots & canvas** — params, Fabric composition, dockable layout  
- **Node graph** — text / image / video / audio / 3D model generation nodes with instruction panel & model params; generation lock, dual gallery outputs; ports must match (singular cannot connect to plural; select nodes accept list ports only); edge styles / minimap; task queue reuses shared upstream, fault-tolerant run mode (failed nodes degrade without aborting the chain); comic page (panel grid + speech bubbles, transparent-PNG export), ad variant matrix, media QA / rework loop (dedicated QA model with five-dimension scoring → auto-retry with FAIL reason injected), 2D frame animation & frame-anim sheet generation, layer separation (export PSD)  
- **Host assets** — boundary ports outside, full graph inside via Dive  
- **Director stage** — 3D pose shots & action recording (`Cache/Videos`); square ports `out-shots` / `out-actions`; 3D model input port auto-instantiates on dive; panorama input auto-set as background; AI scene blockout, 20+ primitives, material texture override (base / normal maps), shading & wireframe modes  
- **Timeline** — import/group clips, scrub tracks; picture-in-picture overlay (position / size / opacity / volume) & video-track transitions; preview selection vs full-timeline play; export  
- **Model providers** — OpenRouter, OpenAI (GPT text / gpt-image), DeepSeek (text), Zhipu (GLM text / CogView image), Kimi / Moonshot (text), xAI / Grok (text / image / video), Google / Gemini (text / image / video), local vLLM (text / Wan video), Ollama / LM Studio (text, OpenAI-compatible, no API key), Volcengine Ark (Seedream / Seedance / voice), Kling, MiniMax, Tongyi Qianwen (DashScope), ModelScope, ComfyUI (API v2: image / video / audio, local or cloud Base URL), MagicRouter (OpenAI-compatible aggregator: text / image / video), Meshy / Tripo / Rodin (Hyper3D) / Luma AI / Lux3D (3D model generation, text-to-3D / image-to-3D)
- **Object storage** — Volcengine TOS, Alibaba Cloud OSS, Tencent Cloud COS (only one enabled at a time; for public reference media URLs)  
- **Extensible** — Editor Kernel + Cordis internal plugins (windows / Inspector / nodes / skills / executors) + declarative external plugin list  

### Providers at a glance

| Kind | Provider | Capabilities |
|------|----------|--------------|
| Model | OpenRouter | Text / image / video (aggregated catalog) |
| Model | OpenAI | Text / image (requires network access to api.openai.com) |
| Model | DeepSeek | Text (deepseek-chat / deepseek-reasoner) |
| Model | Zhipu | GLM text / CogView text-to-image |
| Model | Kimi (Moonshot) | Text (kimi-k2 family / moonshot-v1 family) |
| Model | xAI (Grok) | Text / Grok Imagine image / Grok Imagine Video (async polling) |
| Model | Google (Gemini) | Text / Nano Banana image / Veo 3.1 video (async polling, official OpenAI-compatible layer) |
| Model | vLLM | Local text / video (Wan T2V / I2V, OpenAI-compatible, no API key) |
| Model | Ollama / LM Studio | Local text (OpenAI-compatible, no API key) |
| Model | Volcengine Ark | Text / Seedream / Seedance / voice design |
| Model | Kling | Image / video (API Key) |
| Model | MiniMax | Text / image / video / voice design |
| Model | Tongyi Qianwen | Text (compatible mode) / Wanxiang image & video (incl. HappyHorse) |
| Model | ModelScope | Text / text-to-image (access token) |
| Model | ComfyUI | Image / video / audio (API v2; local :8189 or cloud Base URL) |
| Model | MagicRouter | Text / image / video (OpenAI-compatible aggregator, async video polling) |
| Model | Meshy | Text-to-3D / image-to-3D (incl. multi-image, API key) |
| Model | Tripo | Text-to-3D / image-to-3D (API key) |
| Model | Rodin (Hyper3D) | Text-to-3D / image-to-3D (API key) |
| Model | Luma AI | Text-to-3D / image-to-3D (API key) |
| Model | Lux3D | Text-to-3D / image-to-3D (incl. multi-image, G1 / G1-Turbo, API key) |
| Object storage | TOS / OSS / COS | Upload + signed URLs; mutually exclusive enable |

Configure under **Settings → Models** / **Settings → Object storage**. Local ComfyUI needs [comfy-api-proxy](https://justin-sky.github.io/ai-art-engine/guide-comfyui.en.html) on port 8189 — do not point Base URL at 8188.

---

<a id="quick-start"></a>

## Quick Start

**Installers**

1. Grab a build from [Releases](https://github.com/Justin-sky/ai-art-engine/releases)  
2. Install → create a project  
3. Add model providers (and optional object storage) in Settings  
4. Use toolbar **One-click workflow**, or build chains in shots / node graph  
5. Open the **◈ AI chat** panel in the left rail, `@`-reference assets and let the assistant generate; or follow the [MCP guide](https://justin-sky.github.io/ai-art-engine/guide-mcp.en.html) to connect Claude Code and other external agents  

Full guide: [Manual](https://justin-sky.github.io/ai-art-engine/manual.en.html) (source: `website/manual.en.html`). Local ComfyUI needs [comfy-api-proxy](https://justin-sky.github.io/ai-art-engine/guide-comfyui.en.html) on port 8189 — do not point Base URL at 8188.

**From source**

```bash
git clone https://github.com/Justin-sky/ai-art-engine.git
cd ai-art-engine
npm install
npm run dev
```

Building from source requires **Node.js 22+** (the app bundles its own Node runtime — end users don't need to install Node).

```bash
npm run typecheck && npm test
```

---

## Docs

- [Manual](https://justin-sky.github.io/ai-art-engine/manual.en.html) (`website/manual.en.html`)
- [Architecture](./docs/ARCHITECTURE.md) · [Graph plugins](./docs/GRAPH_PLUGINS.md) · [Docs index](./docs/README.md)
- [Asset model](./docs/ASSET_MODEL.md) · [AssetRef](./docs/ASSET_REF.md) · [Asset package](./docs/ASSET_PACKAGE.md)
- [Roadmap](./docs/ROADMAP.md) · [Changelog](./CHANGELOG.md)

---

## Versioning & updates

- SemVer lives in [`package.json`](./package.json); see [`CHANGELOG.md`](./CHANGELOG.md).
- **Release**: bump `package.json` + CHANGELOG, commit, then tag and push:

```bash
git tag v5.0.0
git push origin v5.0.0
```

  CI verifies the tag (without `v`) matches `package.json`, then builds and publishes a [GitHub Release](https://github.com/Justin-sky/ai-art-engine/releases) (including `latest.yml` for auto-update).
- **In-app updates**: packaged builds check Releases on startup; use **Settings → General → About & updates** to check manually, then restart to install. Dev mode (`npm run dev`) skips update checks.

---

## Contribute

Issues and PRs welcome. Please run `npm run typecheck && npm test` before opening a PR.  
Track bugs on [GitHub Issues](https://github.com/Justin-sky/ai-art-engine/issues).

---

## Community

- **Website**: [justin-sky.github.io/ai-art-engine](https://justin-sky.github.io/ai-art-engine/index.en.html)
- **Video tutorials**: [Bilibili space](https://space.bilibili.com/3707036976024122)
- **QQ group**: 647306826 (scan to join)

  <img src="docs/assets/qq-group.png" alt="AIArtEngine QQ group QR code" width="220" />

- **Email**: [284139554@qq.com](mailto:284139554@qq.com)

---

## License

[GPL-3.0](./LICENSE)

---

<div align="center">
  <p>If this helps you, please give it a ⭐ Star</p>
  <img src="docs/assets/logo-mark.png" alt="" width="40" />
</div>
