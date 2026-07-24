"""Write detailed prompt/promptEn into style-presets/library.json (keeps image fields)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / "src/renderer/src/assets/style-presets/library.json"

# id -> (prompt_zh, prompt_en)
PROMPTS: dict[str, tuple[str, str]] = {
    "hyper-real-photo": (
        "超写实摄影：真实相机质感，自然光学透视与景深，细腻皮肤/材质微纹理，柔和全局光照与真实阴影，色彩还原准确，无插画感、无过度磨皮、无塑料感。",
        "Hyper-realistic photography: real camera look, natural optics and depth of field, fine material micro-texture, soft global illumination and believable shadows, accurate color, no illustration look, no over-smoothed plastic skin.",
    ),
    "cinematic": (
        "电影感：电影布光与色彩分级，高动态对比，戏剧性明暗分割，浅景深与镜头感，胶片般色调与氛围，构图具叙事张力，避免平光证件照感。",
        "Cinematic: film lighting and color grade, high dynamic contrast, dramatic chiaroscuro, shallow depth of field and lens language, filmic mood, narrative framing, avoid flat passport-photo lighting.",
    ),
    "commercial-product": (
        "商业产品摄影：干净棚拍感，均匀柔光与受控高光，背景简洁，产品边缘清晰、材质可读，色彩干净通透，商业广告级完成度，无杂乱道具抢戏。",
        "Commercial product photography: clean studio look, even soft light with controlled highlights, simple backdrop, crisp edges and readable materials, clean commercial finish, no clutter stealing focus.",
    ),
    "japanese-anime": (
        "日系动漫：现代日漫画面，清晰赛璐璐色块与干净线稿，明亮色彩与柔和渐变，二次元光影，非写实皮肤质感，保持动画美学。",
        "Japanese anime: modern anime look, clean cel blocks and linework, bright palette with soft gradients, anime lighting, non-photoreal skin, keep 2D animation aesthetics.",
    ),
    "chibi-cartoon": (
        "Q版卡通：头身比夸张可爱，圆润形体与软萌表情，简化五官与肢体，马卡龙/粉彩色，轻松可爱氛围，避免写实解剖与沉重阴影。",
        "Chibi / Q-style cartoon: exaggerated cute proportions, rounded forms, simplified features, pastel candy colors, playful mood, avoid realistic anatomy and heavy shadows.",
    ),
    "cel-shading": (
        "赛璐璐：硬边色块阴影、有限色阶，干净勾线，平涂为主、少量高光，经典动画上色，轮廓清晰，避免复杂写实纹理与照片噪点。",
        "Cel shading: hard-edged color blocks, limited value steps, clean outlines, mostly flat fills with sparse highlights, classic animation shading, no complex photo textures or noise.",
    ),
    "cartoon-3d": (
        "3D卡通：风格化三维渲染，圆滑曲面与卡通比例，柔和次表面与干净材质，明亮友好光照，玩具/动画短片质感，非写实扫描感。",
        "3D cartoon: stylized 3D render, smooth surfaces and cartoon proportions, soft subsurface and clean materials, bright friendly lighting, toy/short-film look, not photogrammetry realism.",
    ),
    "pixar": (
        "Pixar风：高品质动画电影渲染，亲和造型，细腻次表面散射与织物毛发，电影级布光与景深，温暖情感氛围，精致但不阴郁。",
        "Pixar style: high-end animated-feature rendering, appealing shapes, refined SSS/fabric/hair, cinematic lighting and DOF, warm emotional mood, polished not grim.",
    ),
    "hand-drawn": (
        "手绘插画：可见铅笔/钢笔笔触与手绘纹理，轻微不完美线条，纸面感，艺术插画气息，保留手作温度，避免矢量死板与照片贴图感。",
        "Hand-drawn illustration: visible pencil/ink strokes and paper tooth, slightly imperfect lines, artful sketch energy, handmade warmth, avoid stiff vector look or photo cutouts.",
    ),
    "flat-illustration": (
        "扁平插画：矢量扁平构成，大色块、少透视、少纹理，几何化造型，现代信息图/UI插画感，阴影极简或无阴影，边缘干净。",
        "Flat illustration: vector flat design, big color shapes, little perspective/texture, geometric forms, modern infographic/UI-illustration feel, minimal or no shadows, clean edges.",
    ),
    "watercolor": (
        "水彩：透明叠色与湿边晕染，颜料流动与纸纹，柔和边缘与水渍感，清新透气的色彩层次，保留留白，避免厚重油画堆叠与数码硬边。",
        "Watercolor: transparent washes and wet-edge blooms, pigment flow and paper grain, soft edges and water stains, airy layered color, keep whites, avoid thick oil buildup or hard digital edges.",
    ),
    "oil-painting": (
        "油画：厚涂笔触与可见肌理，油画颜料层叠，古典或印象派光色，丰富暗部与高光，画布纹理，艺术绘画感强，非照片滤镜。",
        "Oil painting: impasto strokes and visible texture, layered oil paint, classical or impressionist light-color, rich shadows and highlights, canvas grain, painterly not a photo filter.",
    ),
    "chinese-ink": (
        "国风水墨：墨色浓淡干湿变化，写意笔法与留白，宣纸晕染，青绿或墨韵气质，东方审美气韵，少繁复西式光影，避免彩色厚涂。",
        "Chinese ink wash: graded ink wet/dry strokes, expressive brushwork and negative space, xuan-paper bleed, Eastern ink elegance, spare Western lighting, avoid heavy polychrome impasto.",
    ),
    "minimalist": (
        "极简设计：极简构图与大量留白，有限配色，干净几何与克制细节，现代设计海报感，信息层级清晰，去除装饰噪音。",
        "Minimalist design: sparse composition and generous whitespace, limited palette, clean geometry, restrained detail, modern poster clarity, remove decorative noise.",
    ),
    "logo-design": (
        "Logo设计：强识别图形符号，简洁黑白或少色，清晰负形与平衡，可缩放的标志感，线条肯定，避免复杂场景与写实照片细节。",
        "Logo design: strong iconic mark, simple mono/few-color, clear negative space and balance, scalable emblem feel, decisive lines, avoid busy scenes and photoreal detail.",
    ),
    "poster-design": (
        "海报设计：大胆排版层级，强对比色块与视觉焦点，宣传海报构图，醒目标题区气质，图形化信息传达，杂志封面完成度。",
        "Poster design: bold typographic hierarchy, strong contrast blocks and focal point, promotional poster composition, graphic communication, magazine-cover finish.",
    ),
    "cyberpunk": (
        "赛博朋克：霓虹品红/青色光，夜城雨湿反光，高科技低生活氛围，体积光与故障美学，冷暖对比强烈，未来都市细节，避免白天清新风。",
        "Cyberpunk: neon magenta/cyan glow, wet night-city reflections, high-tech low-life mood, volumetrics and glitch aesthetics, strong cool-warm contrast, avoid sunny fresh daylight.",
    ),
    "steampunk": (
        "蒸汽朋克：黄铜齿轮与蒸汽管道，维多利亚工业美学，皮革/铆钉/仪表，暖褐铜绿色调，复古机械幻想，蒸汽烟雾氛围。",
        "Steampunk: brass gears and steam pipes, Victorian industrial aesthetic, leather/rivets/gauges, warm copper-sepia palette, retro-mechanical fantasy, steam haze.",
    ),
    "dark-fantasy": (
        "黑暗幻想：阴郁史诗氛围，低键光与浓重暗部，哥特/魔幻材质，冷雾与神秘辉光，沉重色彩，奇幻危险感，避免甜美卡通。",
        "Dark fantasy: grim epic mood, low-key light and deep shadows, gothic/fantasy materials, cold mist and eerie glow, heavy palette, sense of peril, avoid cute cartoon sweetness.",
    ),
    "game-concept": (
        "游戏概念图：游戏原画制作感，清晰可读的设计信息，氛围铺陈与材质暗示，概念设定完整性，数字绘画笔触，服务角色/场景设定表达。",
        "Game concept art: production concept-art clarity, readable design info, mood and material indication, complete concept staging, digital-paint strokes for character/env design.",
    ),
    "character-design": (
        "角色设计：角色设定展示感，清晰的外形、服装与识别特征，造型完整可读，设计表气质，突出人物设计而非环境叙事堆砌。",
        "Character design: character-sheet clarity, readable silhouette/costume/signature traits, complete posing for design read, focus on character design over busy environment story.",
    ),
    "ui-icon": (
        "UI图标：圆角图标画幅与清晰符号，简洁可识别轮廓，适合界面图标的简化造型，统一光源与轻微质感，避免复杂透视场景。",
        "UI icon: rounded-icon framing and clear glyph, simplified readable silhouette for UI, unified light and light material cue, avoid complex perspective scenes.",
    ),
    "pixel-art": (
        "像素艺术：低分辨率像素格，限制色板，清晰像素簇与可选抖动，复古掌机/街机美学，无抗锯齿模糊，保持像素对齐。",
        "Pixel art: low-res pixel grid, limited palette, clean pixel clusters (optional dither), retro handheld/arcade aesthetic, no antialias blur, keep pixel alignment.",
    ),
    "vintage-poster": (
        "复古海报：老印刷网点与做旧纸色，怀旧广告排版气质，褪色油墨与轻微磨损，复古旅行/宣传海报印刷质感。",
        "Vintage poster: aged print halftone and paper tint, nostalgic ad layout, faded ink and light wear, retro travel/poster print texture.",
    ),
    "pop-art": (
        "波普艺术：高饱和撞色，粗黑描边，半调网点，漫画网点与重复图形，安迪沃霍尔式波普冲击力，平面印刷感强。",
        "Pop art: high-saturation clashing colors, thick black outlines, halftone dots, comic Ben-Day energy, Warhol-like pop punch, strong print flatness.",
    ),
    "ukiyo-e": (
        "浮世绘：日本浮世绘木版画，平面色块与流畅勾线，传统配色与波浪/云纹等纹样气质，透视扁平，版画边缘与套色感，非写实油画。",
        "Ukiyo-e: Japanese woodblock print, flat color fields and flowing outlines, traditional palette and pattern vernacular, flattened perspective, print registration feel, not oil realism.",
    ),
    "clay": (
        "黏土风：黏土/橡皮泥雕塑质感，柔软圆角与指纹般微表面，定格动画光照，哑光黏土材质，可爱手作立体感。",
        "Clay style: clay/plasticine sculpt look, soft rounded forms and fingerprint micro-surface, stop-motion lighting, matte clay material, handmade 3D charm.",
    ),
    "low-poly": (
        "Low Poly：低多边形几何面，可见三角面与硬边法线，低模游戏/艺术低面数美学，简洁着色，避免高模细节与照片贴图。",
        "Low poly: faceted low-polygon geometry, visible tris and hard normals, low-poly game/art aesthetic, simple shading, avoid high-poly detail and photo textures.",
    ),
    "children-book": (
        "儿童绘本：温柔手绘绘本风，柔和色彩与友好造型，故事书插画笔触，温暖安全氛围，适合儿童读物的简洁可爱表达。",
        "Children's picture book: gentle storybook illustration, soft colors and friendly shapes, warm safe mood, simple lovable expression for kids' books.",
    ),
    "surrealism": (
        "超现实艺术：梦境逻辑与超现实并置，非常规比例/空间，奇异象征物，迷离光感与诗意不安，超现实主义绘画气质，非日常纪实。",
        "Surrealist art: dream logic and surreal juxtaposition, odd scale/space, uncanny symbols, hazy poetic unease, surrealist painting mood, not everyday documentary.",
    ),
}


def main() -> None:
    data = json.loads(META.read_text(encoding="utf-8"))
    styles = data.get("styles") or []
    missing = []
    for style in styles:
        sid = str(style.get("id") or "")
        base_id = (
            sid.removeprefix("character-").removeprefix("prop-").removeprefix("weapon-")
        )
        pair = PROMPTS.get(base_id) or PROMPTS.get(sid)
        if not pair:
            missing.append(sid)
            continue
        style["prompt"] = pair[0]
        style["promptEn"] = pair[1]
        if not style.get("category"):
            if sid.startswith("character-"):
                style["category"] = "character"
            elif sid.startswith("prop-"):
                style["category"] = "prop"
            elif sid.startswith("weapon-"):
                style["category"] = "weapon"
            else:
                style["category"] = "scene"
    if missing:
        raise SystemExit(f"missing prompts for: {missing}")
    META.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"updated {len(styles)} prompts -> {META}")


if __name__ == "__main__":
    main()
