# 默认画面风格库

清单与缩略图可配置，供 `StyleImagePicker` 使用。风格分五类页签：

- **角色**（`category: "character"`）：人物版总览图 `_sheet-character-source.png`
- **场景**（`category: "scene"`）：场景版总览图 `_sheet-source.png`
- **道具**（`category: "prop"`）：道具版总览图 `_sheet-prop-source.png`
- **武器**（`category: "weapon"`）：武器版总览图 `_sheet-weapon-source.png`
- **UI 界面**（`category: "ui"`）：游戏 UI 界面总览图 `_sheet-ui-source.png`（5 列 × 5 行，底部说明文字已剔除）

## 如何添加 / 修改风格

1. 将缩略图放入本目录（建议 `.webp`）。
2. 编辑 `library.json`，增加或修改条目：

```json
{
  "id": "character-my-style",
  "index": 31,
  "category": "character",
  "name": "我的风格",
  "nameEn": "My style",
  "image": "character-31-my-style.webp",
  "prompt": "中文详细画风提示词（选中后与风格图一并进入生成 prompt）",
  "promptEn": "Detailed English style brief used in the generation prompt with the style image."
}
```

3. 重启开发服务后即可在对应页签中看到。`prompt` / `promptEn` 会在选择风格时写入节点，并在最终提示词中追加「画风要点」。

## 重新从总览图切割

```bash
# 场景（客厅）
python scripts/split-style-sheet.py --category scene

# 角色（人物）
python scripts/split-style-sheet.py --category character

# 道具
python scripts/split-style-sheet.py --category prop

# 武器
python scripts/split-style-sheet.py --category weapon
```

脚本会按 6×5 网格切割并合并进 `library.json`（保留另一分类与已有 prompt）。手工维护时可不依赖该脚本，直接改 JSON 与图片即可。

详细提示词也可批量写入：

```bash
python scripts/write-style-library-prompts.py
```
