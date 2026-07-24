"""
Split a 30-style reference sheet into thumbnails and update library.json.

Examples:
  python scripts/split-style-sheet.py --category scene
  python scripts/split-style-sheet.py --category character
  python scripts/split-style-sheet.py --category prop
  python scripts/split-style-sheet.py --category weapon
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "src/renderer/src/assets/style-presets"
COLS = 6
ROWS = 5

# From dark-bar analysis on 1024x1024 sheet:
# title ~0-54; label bars ~197-231, 386-417, 575-609, 766-801, 959-1023
ROW_IMAGE_Y = [
    (55, 196),
    (232, 385),
    (418, 574),
    (610, 765),
    (802, 958),
]

STYLES = [
    {"id": "hyper-real-photo", "name": "超写实摄影", "nameEn": "Hyper-realistic photography"},
    {"id": "cinematic", "name": "电影感", "nameEn": "Cinematic"},
    {"id": "commercial-product", "name": "商业产品摄影", "nameEn": "Commercial product photography"},
    {"id": "japanese-anime", "name": "日系动漫", "nameEn": "Japanese anime"},
    {"id": "chibi-cartoon", "name": "Q版卡通", "nameEn": "Chibi / Q-style cartoon"},
    {"id": "cel-shading", "name": "赛璐璐", "nameEn": "Cel shading"},
    {"id": "cartoon-3d", "name": "3D卡通", "nameEn": "3D cartoon"},
    {"id": "pixar", "name": "Pixar风", "nameEn": "Pixar style"},
    {"id": "hand-drawn", "name": "手绘插画", "nameEn": "Hand-drawn illustration"},
    {"id": "flat-illustration", "name": "扁平插画", "nameEn": "Flat illustration"},
    {"id": "watercolor", "name": "水彩", "nameEn": "Watercolor"},
    {"id": "oil-painting", "name": "油画", "nameEn": "Oil painting"},
    {"id": "chinese-ink", "name": "国风水墨", "nameEn": "Chinese ink wash"},
    {"id": "minimalist", "name": "极简设计", "nameEn": "Minimalist design"},
    {"id": "logo-design", "name": "Logo设计", "nameEn": "Logo design"},
    {"id": "poster-design", "name": "海报设计", "nameEn": "Poster design"},
    {"id": "cyberpunk", "name": "赛博朋克", "nameEn": "Cyberpunk"},
    {"id": "steampunk", "name": "蒸汽朋克", "nameEn": "Steampunk"},
    {"id": "dark-fantasy", "name": "黑暗幻想", "nameEn": "Dark fantasy"},
    {"id": "game-concept", "name": "游戏概念图", "nameEn": "Game concept art"},
    {"id": "character-design", "name": "角色设计", "nameEn": "Character design"},
    {"id": "ui-icon", "name": "UI图标", "nameEn": "UI icon"},
    {"id": "pixel-art", "name": "像素艺术", "nameEn": "Pixel art"},
    {"id": "vintage-poster", "name": "复古海报", "nameEn": "Vintage poster"},
    {"id": "pop-art", "name": "波普艺术", "nameEn": "Pop art"},
    {"id": "ukiyo-e", "name": "浮世绘", "nameEn": "Ukiyo-e"},
    {"id": "clay", "name": "黏土风", "nameEn": "Clay style"},
    {"id": "low-poly", "name": "Low Poly", "nameEn": "Low poly"},
    {"id": "children-book", "name": "儿童绘本", "nameEn": "Children's picture book"},
    {"id": "surrealism", "name": "超现实艺术", "nameEn": "Surrealist art"},
]

SHEET_BY_CATEGORY = {
    "scene": OUT_DIR / "_sheet-source.png",
    "character": OUT_DIR / "_sheet-character-source.png",
    "prop": OUT_DIR / "_sheet-prop-source.png",
    "weapon": OUT_DIR / "_sheet-weapon-source.png",
}

ID_PREFIX = {
    "scene": "",
    "character": "character-",
    "prop": "prop-",
    "weapon": "weapon-",
}


def style_id(category: str, base_id: str) -> str:
    # 场景保留旧 id 以兼容已有工程引用
    return f"{ID_PREFIX[category]}{base_id}"


def file_name(category: str, index: int, base_id: str) -> str:
    if category == "scene":
        return f"{index:02d}-{base_id}.webp"
    return f"{category}-{index:02d}-{base_id}.webp"


def infer_category(row: dict) -> str:
    cat = row.get("category")
    if cat in ("scene", "character", "prop", "weapon"):
        return str(cat)
    rid = str(row.get("id") or "")
    if rid.startswith("character-"):
        return "character"
    if rid.startswith("prop-"):
        return "prop"
    if rid.startswith("weapon-"):
        return "weapon"
    return "scene"


def load_library(meta_path: Path) -> list[dict]:
    if not meta_path.exists():
        return []
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        rows = data.get("styles") or []
        return [row for row in rows if isinstance(row, dict) and row.get("id")]
    except Exception:
        return []


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--category",
        choices=("scene", "character", "prop", "weapon"),
        required=True,
        help="scene=场景; character=角色; prop=道具; weapon=武器",
    )
    args = parser.parse_args()
    category: str = args.category
    src = SHEET_BY_CATEGORY[category]
    if not src.exists():
        raise SystemExit(f"missing sheet: {src}")

    im = Image.open(src).convert("RGB")
    w, h = im.size
    assert w == 1024 and h == 1024, (w, h)
    assert len(STYLES) == COLS * ROWS

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cell_w = w / COLS
    meta_path = OUT_DIR / "library.json"
    existing = load_library(meta_path)
    existing_by_id = {str(row["id"]): row for row in existing}

    # 同源风格的场景条目，用于给角色/道具复制 prompt
    scene_prompt_by_base = {
        str(row["id"]): row for row in existing if infer_category(row) == "scene"
    }

    updated_ids: set[str] = set()
    new_rows: list[dict] = []

    for index, style in enumerate(STYLES):
        row = index // COLS
        col = index % COLS
        y0, y1 = ROW_IMAGE_Y[row]
        x0 = int(round(col * cell_w))
        x1 = int(round((col + 1) * cell_w))
        x0 = min(w - 1, x0 + (1 if col > 0 else 0))
        x1 = max(x0 + 1, x1 - (1 if col < COLS - 1 else 0))

        crop = im.crop((x0, y0, x1, y1 + 1))
        base_id = style["id"]
        sid = style_id(category, base_id)
        fname = file_name(category, index + 1, base_id)
        out_path = OUT_DIR / fname
        crop.save(out_path, "WEBP", quality=85, method=6)

        entry: dict = {
            "id": sid,
            "index": index + 1,
            "category": category,
            "name": style["name"],
            "nameEn": style["nameEn"],
            "image": fname,
        }
        prev = existing_by_id.get(sid) or {}
        scene_prev = scene_prompt_by_base.get(base_id) or {}
        prompt = prev.get("prompt") or scene_prev.get("prompt")
        prompt_en = prev.get("promptEn") or scene_prev.get("promptEn")
        if isinstance(prompt, str) and prompt.strip():
            entry["prompt"] = prompt.strip()
        if isinstance(prompt_en, str) and prompt_en.strip():
            entry["promptEn"] = prompt_en.strip()

        new_rows.append(entry)
        updated_ids.add(sid)
        print(f"wrote {out_path} ({crop.size[0]}x{crop.size[1]})")

    # 合并：保留其他分类条目，替换本分类
    merged = [row for row in existing if str(row.get("id")) not in updated_ids]
    for row in merged:
        row["category"] = infer_category(row)
    merged.extend(new_rows)
    # 稳定排序：角色 → 场景 → 道具 → 武器；同类按 index
    order = {"character": 0, "scene": 1, "prop": 2, "weapon": 3}

    def sort_key(row: dict) -> tuple:
        cat = infer_category(row)
        return (order.get(cat, 9), int(row.get("index") or 0), str(row.get("id") or ""))

    merged.sort(key=sort_key)

    meta_path.write_text(
        json.dumps({"version": 2, "styles": merged}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {meta_path} ({len(merged)} styles)")


if __name__ == "__main__":
    main()
