/**
 * 内置音效库预设：转场 / UI / 环境三类，复用「生成音效」的 instrumental 生成管线。
 * 文案为 zh/en 双语域数据（每行成对字面量，cjk 守卫自动豁免），按当前语言取用。
 */

export type SfxPresetCategory = 'transition' | 'ui' | 'ambient'

export interface LocalizedText {
  zh: string
  en: string
}

export interface SfxPreset {
  id: string
  category: SfxPresetCategory
  /** 双语显示名 */
  name: LocalizedText
  /** 双语生成 prompt（instrumental 描述：音色 / 情绪 / 场景） */
  prompt: LocalizedText
  /** 预计时长（秒，仅展示参考） */
  durationSec?: number
}

export interface SfxPresetCategoryMeta {
  id: SfxPresetCategory
  label: LocalizedText
}

export const SFX_PRESET_CATEGORIES: SfxPresetCategoryMeta[] = [
  { id: 'transition', label: { zh: '转场', en: 'Transitions' } },
  { id: 'ui', label: { zh: 'UI 音效', en: 'UI sounds' } },
  { id: 'ambient', label: { zh: '环境音', en: 'Ambience' } }
]

export const SFX_PRESETS: SfxPreset[] = [
  // ── 转场 ──
  { id: 'transition-whoosh', category: 'transition', name: { zh: '呼啸转场', en: 'Whoosh transition' }, prompt: { zh: '短促的呼啸风声式转场音效，气流快速划过，干净利落，无杂音', en: 'Short whoosh air-sweep transition sound, clean and quick, no noise' }, durationSec: 1 },
  { id: 'transition-whoosh-quick', category: 'transition', name: { zh: '快速轻转场', en: 'Quick swoosh' }, prompt: { zh: '轻盈快速的 swoosh 转场音效，一瞬划过，轻巧利落', en: 'Light fast swoosh transition, one quick pass, airy and crisp' }, durationSec: 1 },
  { id: 'transition-impact', category: 'transition', name: { zh: '重击转场', en: 'Impact hit' }, prompt: { zh: '有力的低频重击转场音效，伴随短促轰鸣，冲击感强', en: 'Punchy low-frequency impact transition with a short boom, strong impact' }, durationSec: 2 },
  { id: 'transition-riser', category: 'transition', name: { zh: '上升紧张转场', en: 'Riser build-up' }, prompt: { zh: '渐强的上升紧张感转场音效，由弱到强推至顶点，悬疑张力', en: 'Building riser transition that grows from soft to peak tension, suspenseful' }, durationSec: 3 },
  { id: 'transition-downlifter', category: 'transition', name: { zh: '下坠收尾转场', en: 'Downlifter' }, prompt: { zh: '从高处下坠收束的转场音效，音高渐降沉底，干净收尾', en: 'Descending downlifter transition, pitch falls and settles, clean finish' }, durationSec: 2 },
  { id: 'transition-glitch', category: 'transition', name: { zh: '故障电子转场', en: 'Glitch transition' }, prompt: { zh: '数字化故障感的电子转场音效，短促失真与抖动，科技未来感', en: 'Digital glitch transition with short distortions and stutters, futuristic' }, durationSec: 1 },
  { id: 'transition-swish', category: 'transition', name: { zh: '挥动甩镜转场', en: 'Swish' }, prompt: { zh: '挥动甩镜式转场音效，快速划破空气，力量与速度感', en: 'Swish transition like a fast camera whip, cutting through air, energetic' }, durationSec: 1 },
  { id: 'transition-boom', category: 'transition', name: { zh: '低频轰隆转场', en: 'Boom' }, prompt: { zh: '低频轰隆转场音效，厚重绵长的轰鸣，宏大庄重', en: 'Deep booming transition, thick and resonant, grand and weighty' }, durationSec: 2 },

  // ── UI 音效 ──
  { id: 'ui-click', category: 'ui', name: { zh: '清脆点击', en: 'Click' }, prompt: { zh: '清脆短促的按钮点击音效，颗粒感清晰，干净不拖尾', en: 'Crisp short button click, clear and clean, no tail' }, durationSec: 1 },
  { id: 'ui-soft-tap', category: 'ui', name: { zh: '轻柔点按', en: 'Soft tap' }, prompt: { zh: '轻柔温和的触控点按音效，柔和不发闷', en: 'Soft gentle touch tap sound, warm and subtle' }, durationSec: 1 },
  { id: 'ui-beep', category: 'ui', name: { zh: '提示音', en: 'Beep' }, prompt: { zh: '单声简洁的提示音效，音调明亮清晰', en: 'Single clean beep, bright and clear tone' }, durationSec: 1 },
  { id: 'ui-notification', category: 'ui', name: { zh: '通知提示', en: 'Notification' }, prompt: { zh: '三连音的通知提示音效，轻快醒目，现代感', en: 'Three-note notification chime, lively and noticeable, modern' }, durationSec: 1 },
  { id: 'ui-pop', category: 'ui', name: { zh: '弹出音效', en: 'Pop' }, prompt: { zh: '气泡弹出般的轻快音效，短促俏皮', en: 'Bouncy bubble pop sound, short and playful' }, durationSec: 1 },
  { id: 'ui-confirm', category: 'ui', name: { zh: '确认成功', en: 'Confirm' }, prompt: { zh: '上扬明快的确认成功音效，积极干脆', en: 'Rising bright confirmation sound, positive and decisive' }, durationSec: 1 },
  { id: 'ui-error-buzz', category: 'ui', name: { zh: '操作错误', en: 'Error buzz' }, prompt: { zh: '低频短促的提示错误音效，轻微嗡鸣，不刺耳', en: 'Low short error buzz, gentle hum, not harsh' }, durationSec: 1 },

  // ── 环境音 ──
  { id: 'ambient-rain', category: 'ambient', name: { zh: '雨天环境', en: 'Rain' }, prompt: { zh: '持续的雨声环境音，均匀细雨落在地面的沙沙声，舒缓宁静', en: 'Steady rain ambience, soft drizzle pattering, calm and soothing' }, durationSec: 10 },
  { id: 'ambient-forest', category: 'ambient', name: { zh: '森林鸟鸣', en: 'Forest birds' }, prompt: { zh: '清晨森林环境音，远近鸟鸣与微风轻拂树叶，自然清新', en: 'Morning forest ambience with distant birdsong and gentle breeze, fresh' }, durationSec: 10 },
  { id: 'ambient-crowd', category: 'ambient', name: { zh: '人群嘈杂', en: 'Crowd murmur' }, prompt: { zh: '远处人群交谈的嘈杂环境音，混响温和，适合街景背景', en: 'Distant crowd murmur ambience, soft reverb, street background feel' }, durationSec: 10 },
  { id: 'ambient-wind', category: 'ambient', name: { zh: '风声', en: 'Wind' }, prompt: { zh: '持续的风声环境音，气流平稳起伏，空旷悠远', en: 'Steady wind ambience, smooth airflow swells, open and vast' }, durationSec: 10 },
  { id: 'ambient-waves', category: 'ambient', name: { zh: '海浪', en: 'Ocean waves' }, prompt: { zh: '海边海浪拍岸环境音，波浪起伏循环，放松治愈', en: 'Ocean waves ambience, rhythmic surf rolling in, relaxing' }, durationSec: 10 },
  { id: 'ambient-coffee-shop', category: 'ambient', name: { zh: '咖啡馆环境', en: 'Coffee shop' }, prompt: { zh: '咖啡馆环境音，低语人声、杯碟轻响与柔和背景氛围，慵懒惬意', en: 'Coffee shop ambience, low chatter with soft cup clinks, cozy and lazy' }, durationSec: 10 },
  { id: 'ambient-thunder', category: 'ambient', name: { zh: '雷雨', en: 'Thunderstorm' }, prompt: { zh: '远处闷雷与雨声交织的环境音，低沉酝酿，戏剧氛围', en: 'Distant thunder rolling through rain ambience, low and dramatic' }, durationSec: 10 }
]

/** 取当前语言文本 */
export function localizedText(locale: string, value: LocalizedText): string {
  return locale.toLowerCase().startsWith('en') ? value.en : value.zh
}
