# ai-art-engine-mcp

Zero-dependency **Model Context Protocol (MCP)** stdio bridge for [**AI Art Engine**](https://github.com/Justin-sky/ai-art-engine) — the open-source, local-first AI creative & game asset production engine (**102 MCP tools** across Windows, macOS, and Linux).

Instead of returning flat, uneditable PNGs, `ai-art-engine-mcp` gives **Claude Code**, **Cursor**, **Codex**, **Windsurf**, **Cline**, and **Roo Code** direct local control to compile pipeline-ready engineering artifacts:

- **Game UI Layer Split & Atlas Compose** → Native Photoshop **editable `TySh` `.psd`** + **Unity UXML/UGUI (C#)** + **Godot 4 `.tscn`** + HTML5
- **Machinations Game Economy Sandbox** → 59 verified system-dynamics blocks, Monte Carlo P10/P50/P90 simulation, **120fps curve-drag goal-seek solver**, and **Unity C# / Godot GDScript** export
- **2D Spine Rigging & Wavelet Portrait Lab** → Auto bone alignment, part segmentation, **Spine 2D (`skeleton.json` + `.atlas`)**, and 4-band wavelet retouching
- **AI Short-Drama 5-Stage Workbench & Video Reverse-Engineering** → Character identity lock (`@1`–`@4`), multi-track timeline, and **CapCut / Jianying editable draft** export
- **3D Director Stage, Blender MCP & 3D Gaussian Splatting** → 56-bone humanoid blocking, live Blender `bpy` modeling (`--blender`), and World Labs `.spz`/`.glb` worlds
- **Playable Single-File HTML5 Games** → Built-in headless browser frame-diff smoke verification
- **Free Local GPU Vision** → Bundled ONNX Runtime (`YOLOv8` / `SAM2`) + native offline OS OCR

---

## Quick Start

### 1. Install & Launch AI Art Engine Desktop (Free & Open Source)

Download the latest release for **Windows / macOS / Linux**:

- **GitHub Releases**: https://github.com/Justin-sky/ai-art-engine/releases
- **Website & Docs**: https://justin-sky.github.io/ai-art-engine/

When launched, AI Art Engine automatically starts its authenticated local MCP server on `127.0.0.1:43110` and writes `<appData>/AIArtEngine/mcp.json` — **zero manual token copying required**.

### 2. Connect Your Coding Agent

#### Claude Code

```bash
claude mcp add ai-art-engine -- npx -y ai-art-engine-mcp
# Optional: also add the 9-tool live Blender 3D MCP endpoint
claude mcp add ai-art-engine-blender -- npx -y ai-art-engine-mcp --blender
```

#### Cursor / Windsurf / Claude Desktop (`mcp.json`)

```json
{
  "mcpServers": {
    "ai-art-engine": {
      "command": "npx",
      "args": ["-y", "ai-art-engine-mcp"]
    }
  }
}
```

---

## Environment Variables (Optional)

Auto-discovery works out of the box on Windows, macOS, and Linux. Override only when needed:

| Variable            | Description                              |
| :------------------ | :--------------------------------------- |
| `AIAE_MCP_CONFIG`   | Explicit path to `mcp.json`              |
| `AIAE_MCP_PORT`     | Local MCP port (default: `43110`)        |
| `AIAE_MCP_TOKEN`    | Bearer token from `mcp.json`             |
| `AIAE_MCP_ENDPOINT` | Endpoint path (`/mcp` or `/mcp/blender`) |

## License

GPL-3.0-only — Full source code at [Justin-sky/ai-art-engine](https://github.com/Justin-sky/ai-art-engine).
