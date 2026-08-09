<div align="center">
  <img src="docs/assets/logo-mark.png" alt="" width="96" />

  <h1>AI Art Engine</h1>

  <p><b>Professional AI creation tool · short drama · ads · film</b></p>
  <p>
    Local-first projects · Shot & node-graph workflows<br />
    OpenRouter · OpenAI · DeepSeek · Zhipu · Kimi · xAI · Google · vLLM · Ollama · LM Studio · Volcengine Ark · Kling · MiniMax · Tongyi Qianwen · ModelScope<br />
    Object storage: Volcengine TOS · Alibaba Cloud OSS · Tencent Cloud COS
  </p>

  <p>
    <a href="https://github.com/Justin-sky/ai-art-engine/stargazers"><img src="https://img.shields.io/github/stars/Justin-sky/ai-art-engine?style=social" alt="GitHub stars" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/network/members"><img src="https://img.shields.io/github/forks/Justin-sky/ai-art-engine?style=social" alt="GitHub forks" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/v/release/Justin-sky/ai-art-engine?include_prereleases&label=release&style=flat-square" alt="release" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg?style=flat-square" alt="license" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/blob/main/package.json"><img src="https://img.shields.io/badge/version-2.0.2-orange.svg?style=flat-square" alt="version" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Local--First-00B894?style=for-the-badge" alt="local" />
    <img src="https://img.shields.io/badge/Node_Graph-6C5CE7?style=for-the-badge" alt="graph" />
    <img src="https://img.shields.io/badge/Win%20%7C%20macOS%20%7C%20Linux-0984E3?style=for-the-badge" alt="platform" />
  </p>

  <p>
    <a href="https://justin-sky.github.io/ai-art-engine/"><b>Website</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/manual.html"><b>Manual</b></a> ·
    <a href="https://space.bilibili.com/3707036976024122"><b>Video tutorials</b></a> ·
    <a href="https://github.com/Justin-sky/ai-art-engine/releases"><b>Download</b></a> ·
    <a href="#community"><b>Community</b></a> ·
    <a href="#features"><b>Features</b></a> ·
    <a href="#quick-start"><b>Quick Start</b></a> ·
    <a href="./README.md"><b>中文</b></a>
  </p>
</div>

---

## Website

Landing page sources live in `website/`:

| Channel | URL |
|---------|-----|
| **GitHub Pages** | https://justin-sky.github.io/ai-art-engine/ |
| **Alibaba Cloud OSS** (CN) | After deploy: custom domain / `publicBaseUrl` |

Do not use paths with `/website/` (e.g. `.../website/index.html`) — they 404.

```bash
npm run site                   # local preview
npm run site:deploy            # deploy website/ to Alibaba Cloud OSS
```

Copy `oss-website.example.json` to `oss-website.local.json`, fill AccessKey / bucket / region (e.g. `oss-cn-hangzhou`), then run `npm run site:deploy`. Bind a custom domain for HTML preview (default OSS domains may force download; mainland domains require ICP filing).

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

- **Local projects** — create / open / recent; JSON + media on disk  
- **One-click workflow** — preset or AI-planned topology → reusable host asset (boundary I/O + Dive)  
- **Assets** — image / video / audio; AssetRef GUIDs; `.aipackage`  
- **Shots & canvas** — params, Fabric composition, dockable layout  
- **Node graph** — generation nodes; dual gallery outputs; edge styles / minimap; task queue reuses shared upstream  
- **Host assets** — boundary ports outside, full graph inside via Dive  
- **Director stage** — 3D pose shots & action recording (`Cache/Videos`); square ports `out-shots` / `out-actions`  
- **Timeline** — import/group clips, scrub tracks; preview selection vs full-timeline play; export  
- **Model providers** — OpenRouter, OpenAI (GPT text / gpt-image), DeepSeek (text), Zhipu (GLM text / CogView image), Kimi / Moonshot (text), xAI / Grok (text / image / video), Google / Gemini (text), local vLLM (text / Wan video), Ollama / LM Studio (text, OpenAI-compatible, no API key), Volcengine Ark (Seedream / Seedance / voice), Kling, MiniMax, Tongyi Qianwen (DashScope), ModelScope  
- **Object storage** — Volcengine TOS, Alibaba Cloud OSS, Tencent Cloud COS (only one enabled at a time; for public reference media URLs)  
- **Extensible** — Editor Kernel + declarative extensions  

### Providers at a glance

| Kind | Provider | Capabilities |
|------|----------|--------------|
| Model | OpenRouter | Text / image / video (aggregated catalog) |
| Model | OpenAI | Text / image (requires network access to api.openai.com) |
| Model | DeepSeek | Text (deepseek-chat / deepseek-reasoner) |
| Model | Zhipu | GLM text / CogView text-to-image |
| Model | Kimi (Moonshot) | Text (kimi-k2 family / moonshot-v1 family) |
| Model | xAI (Grok) | Text / Grok Imagine image / Grok Imagine Video (async polling) |
| Model | Google (Gemini) | Text (official OpenAI-compatible layer) |
| Model | vLLM | Local text / video (Wan T2V / I2V, OpenAI-compatible, no API key) |
| Model | Ollama / LM Studio | Local text (OpenAI-compatible, no API key) |
| Model | Volcengine Ark | Text / Seedream / Seedance / voice design |
| Model | Kling | Image / video (API Key) |
| Model | MiniMax | Text / image / video / voice design |
| Model | Tongyi Qianwen | Text (compatible mode) / Wanxiang image & video (incl. HappyHorse) |
| Model | ModelScope | Text / text-to-image (access token) |
| Object storage | TOS / OSS / COS | Upload + signed URLs; mutually exclusive enable |

Configure under **Settings → Models** / **Settings → Object storage**.

---

<a id="quick-start"></a>

## Quick Start

**Installers**

1. Grab a build from [Releases](https://github.com/Justin-sky/ai-art-engine/releases)  
2. Install → create a project  
3. Add model providers (and optional object storage) in Settings  
4. Use toolbar **One-click workflow**, or build chains in shots / node graph  

Full guide: [Manual](https://justin-sky.github.io/ai-art-engine/manual.html) (source: `website/manual.html`).

**From source**

```bash
git clone https://github.com/Justin-sky/ai-art-engine.git
cd ai-art-engine
npm install
npm run dev
```

Requires **Node.js 22+**.

```bash
npm run typecheck && npm test
```

---

## Versioning & updates

- SemVer lives in [`package.json`](./package.json); see [`CHANGELOG.md`](./CHANGELOG.md).
- **Release**: bump `package.json` + CHANGELOG, commit, then tag and push:

```bash
git tag v2.0.2
git push origin v2.0.2
```

  CI verifies the tag (without `v`) matches `package.json`, then builds and publishes a [GitHub Release](https://github.com/Justin-sky/ai-art-engine/releases) (including `latest.yml` for auto-update).
- **In-app updates**: packaged builds check Releases on startup; use **Settings → General → About & updates** to check manually, then restart to install. Dev mode (`npm run dev`) skips update checks.

---

## Contribute

Issues and PRs welcome. Please run `npm run typecheck && npm test` before opening a PR.  
Track bugs on [GitHub Issues](https://github.com/Justin-sky/ai-art-engine/issues).

---

## Community

- **Website**: [justin-sky.github.io/ai-art-engine](https://justin-sky.github.io/ai-art-engine/)
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
