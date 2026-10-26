/**
 * 跨游戏引擎原生自动化导入脚本生成器（Godot 4 GDScript / Unity C# AssetPostprocessor / Web ESM Loader）。
 *
 * 在 `game_bundle_export` 导出标准工程包时同步生成对应引擎的自动化装配脚本，
 * 彻底省去开发者进入引擎后手动逐张勾选 Sprite 类型、法线贴图类型、九宫格切线与随机音效池的繁琐配置。
 */

import type { GameBundleManifest } from './gameBundleManifest'

export interface GeneratedEngineImporterScript {
  /** 相对于导出工程包根目录的脚本路径 */
  relativePath: string
  language: 'gdscript' | 'csharp' | 'javascript'
  description: string
  content: string
}

function buildGodot4ImporterGdScript(manifest: GameBundleManifest): GeneratedEngineImporterScript {
  const content = `@tool
extends EditorScript
## AIArtEngine Godot 4.x Auto-Importer Script (Bundle: ${manifest.bundleName})
## Open in Godot Editor and click File -> Run (Ctrl+Shift+X) to auto-configure
## StyleBoxTexture (.tres) for 9-slice UI and AudioStreamRandomizer (.tres) for SFX variants.

const MANIFEST_PATH := "res://game-asset-manifest.json"

func _run() -> void:
\tif not FileAccess.file_exists(MANIFEST_PATH):
\t\tpush_error("[AIArtEngine] Manifest not found: " + MANIFEST_PATH)
\t\treturn
\tvar raw := FileAccess.get_file_as_string(MANIFEST_PATH)
\tvar data = JSON.parse_string(raw)
\tif typeof(data) != TYPE_DICTIONARY:
\t\tpush_error("[AIArtEngine] Failed to parse manifest JSON")
\t\treturn
\tvar assets: Array = data.get("assets", [])
\tvar sfx_groups := {}
\tvar stylebox_count := 0
\tfor item in assets:
\t\tvar rel_path: String = "res://" + String(item.get("bundleRelativePath", ""))
\t\tvar category: String = String(item.get("category", ""))
\t\tif category == "audio_sfx" and ResourceLoader.exists(rel_path):
\t\t\tvar stem := rel_path.get_file().get_basename()
\t\t\tvar regex := RegEx.new()
\t\t\tregex.compile("^(.*)_v\\\\d+$")
\t\t\tvar m := regex.search(stem)
\t\t\tif m:
\t\t\t\tvar group_key := m.get_string(1)
\t\t\t\tif not sfx_groups.has(group_key):
\t\t\t\t\tsfx_groups[group_key] = []
\t\t\t\tsfx_groups[group_key].append(rel_path)
\t\tif category == "data" and rel_path.ends_with("_9slice.json") and FileAccess.file_exists(rel_path):
\t\t\t_create_stylebox_from_9slice(rel_path)
\t\t\tstylebox_count += 1
\tvar randomizer_count := 0
\tfor group_key in sfx_groups.keys():
\t\tvar paths: Array = sfx_groups[group_key]
\t\tif paths.size() > 1:
\t\t\tvar rand_stream := AudioStreamRandomizer.new()
\t\t\tfor p in paths:
\t\t\t\tvar stream = load(p)
\t\t\t\tif stream:
\t\t\t\t\trand_stream.add_stream(-1, stream, 1.0)
\t\t\tvar out_tres := "res://assets/audio/sfx/" + group_key + "_randomizer.tres"
\t\t\tResourceSaver.save(rand_stream, out_tres)
\t\t\trandomizer_count += 1
\tprint("[AIArtEngine] Bundle import complete: ", assets.size(), " assets, ", stylebox_count, " StyleBoxTexture, ", randomizer_count, " AudioStreamRandomizer.")

func _create_stylebox_from_9slice(json_path: String) -> void:
\tvar meta = JSON.parse_string(FileAccess.get_file_as_string(json_path))
\tif typeof(meta) != TYPE_DICTIONARY:
\t\treturn
\tvar borders: Dictionary = meta.get("borders", {})
\tvar sb := StyleBoxTexture.new()
\tsb.texture_margin_top = float(borders.get("top", 8))
\tsb.texture_margin_right = float(borders.get("right", 8))
\tsb.texture_margin_bottom = float(borders.get("bottom", 8))
\tsb.texture_margin_left = float(borders.get("left", 8))
\tvar out_tres := json_path.replace("_9slice.json", "_stylebox.tres")
\tResourceSaver.save(sb, out_tres)
`
  return {
    relativePath: 'import_game_bundle.gd',
    language: 'gdscript',
    description:
      'Godot 4.x EditorScript：一键配置 StyleBoxTexture 九宫格与 AudioStreamRandomizer 随机音效池', // cjk-ok
    content
  }
}

function buildUnityAssetPostprocessorCs(
  manifest: GameBundleManifest
): GeneratedEngineImporterScript {
  const content = `// AIArtEngine Unity AssetPostprocessor (Bundle: ${manifest.bundleName})
// Place under Assets/GameArt/Editor/ to auto-configure NormalMap, Sprite (2D and UI), and 9-slice spriteBorder.
#if UNITY_EDITOR
using System.IO;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace AIArtEngine.Editor
{
    public class AiArtBundlePostprocessor : AssetPostprocessor
    {
        private void OnPreprocessTexture()
        {
            if (!assetPath.StartsWith("Assets/GameArt/")) return;

            var importer = (TextureImporter)assetImporter;
            var lower = assetPath.ToLowerInvariant();

            if (lower.Contains("_normal."))
            {
                importer.textureType = TextureImporterType.NormalMap;
                return;
            }

            if (lower.Contains("/sprites/") || lower.Contains("/ui/") || lower.Contains("/vfx/") || lower.Contains("/tilemaps/"))
            {
                importer.textureType = TextureImporterType.Sprite;
                importer.alphaIsTransparency = true;
                importer.mipmapEnabled = false;

                string stem = Path.GetFileNameWithoutExtension(assetPath);
                string dir = Path.GetDirectoryName(assetPath) ?? "";
                string nineSlicePath = Path.Combine(dir, stem + "_9slice.json");
                if (File.Exists(nineSlicePath))
                {
                    string json = File.ReadAllText(nineSlicePath);
                    var match = Regex.Match(json, @"""borderLBRT""\\s*:\\s*\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]");
                    if (match.Success)
                    {
                        float l = float.Parse(match.Groups[1].Value);
                        float b = float.Parse(match.Groups[2].Value);
                        float r = float.Parse(match.Groups[3].Value);
                        float t = float.Parse(match.Groups[4].Value);
                        importer.spriteBorder = new Vector4(l, b, r, t);
                    }
                }
            }
        }
    }
}
#endif
`
  return {
    relativePath: 'Assets/GameArt/Editor/AiArtBundlePostprocessor.cs',
    language: 'csharp',
    description:
      'Unity Editor AssetPostprocessor：自动设置 Sprite / NormalMap 类型与九宫格 spriteBorder', // cjk-ok
    content
  }
}

function buildWebGameBundleLoaderMjs(manifest: GameBundleManifest): GeneratedEngineImporterScript {
  const sfxGroups: Record<string, string[]> = {}
  for (const item of manifest.assets) {
    if (item.category === 'audio_sfx') {
      const m = /^(.*)_v\d+\.[a-z0-9]+$/i.exec(item.bundleRelativePath.split('/').pop() ?? '')
      const key = m ? m[1]! : item.name
      if (!sfxGroups[key]) sfxGroups[key] = []
      sfxGroups[key]!.push(item.bundleRelativePath)
    }
  }

  const content = `/**
 * AIArtEngine Web / Phaser 3 / PixiJS / Three.js Bundle Loader (Bundle: ${manifest.bundleName})
 */
export const GAME_BUNDLE_SUMMARY = ${JSON.stringify(
    {
      bundleName: manifest.bundleName,
      targetEngine: manifest.targetEngine,
      totalAssets: manifest.totalAssets,
      countsByCategory: manifest.countsByCategory
    },
    null,
    2
  )};

export const SFX_VARIANT_POOLS = ${JSON.stringify(sfxGroups, null, 2)};

/**
 * Pick a non-repeating random SFX variant path from the pool.
 */
const _lastPickedIndex = new Map();
export function pickRandomSfxVariant(poolKey) {
  const list = SFX_VARIANT_POOLS[poolKey];
  if (!Array.isArray(list) || list.length === 0) return null;
  if (list.length === 1) return list[0];
  const prev = _lastPickedIndex.get(poolKey) ?? -1;
  let idx = Math.floor(Math.random() * list.length);
  if (idx === prev) idx = (idx + 1) % list.length;
  _lastPickedIndex.set(poolKey, idx);
  return list[idx];
}

/**
 * Load full game-asset-manifest.json
 */
export async function fetchGameBundleManifest(baseUrl = '.') {
  const res = await fetch(\`\${baseUrl.replace(/\\/+$/, '')}/game-asset-manifest.json\`);
  if (!res.ok) throw new Error(\`Failed to load game-asset-manifest.json: \${res.status}\`);
  return res.json();
}
`
  return {
    relativePath: 'loadGameBundle.mjs',
    language: 'javascript',
    description:
      'Web / Cocos / 通用 ESM 资产加载器：内建防听觉疲劳随机音效池 pickRandomSfxVariant 与清单拉取', // cjk-ok
    content
  }
}

/**
 * 根据工程包的目标引擎生成配套的原生自动化导入脚本。
 */
export function generateEngineImporterScript(
  manifest: GameBundleManifest
): GeneratedEngineImporterScript {
  if (manifest.targetEngine === 'godot') {
    return buildGodot4ImporterGdScript(manifest)
  }
  if (manifest.targetEngine === 'unity') {
    return buildUnityAssetPostprocessorCs(manifest)
  }
  return buildWebGameBundleLoaderMjs(manifest)
}
