<template>
  <div
    v-if="resolvedPalette !== 'classic'"
    class="canvas-genshin-vista"
    :class="`is-palette-${resolvedPalette}`"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasScenePaletteId } from '@shared/domain'
import { editorPreferences } from '../editor/preferences'
import { canvasWeatherState, type WeatherKind } from '../graph/vfx/canvasWeatherEngine'

const palettePref = editorPreferences.canvasPalette
const currentWeather = canvasWeatherState.currentWeather

function mapWeatherToGenshinPalette(
  weather: WeatherKind
): Exclude<CanvasScenePaletteId, 'auto' | 'classic'> {
  switch (weather) {
    case 'rain':
    case 'fog':
      return 'fontaine'
    case 'hail':
      return 'celestia'
    case 'meteor':
    case 'aurora':
      return 'starry_night'
    case 'thunderstorm':
    case 'typhoon':
      return 'twilight_dusk'
    case 'sandstorm':
      return 'natlan'
    case 'blizzard':
    case 'sunny':
      return 'liyue'
    case 'wind':
    case 'idle':
    default:
      return 'mondstadt'
  }
}

const resolvedPalette = computed<Exclude<CanvasScenePaletteId, 'auto'>>(() => {
  const pref = palettePref.value
  if (pref === 'classic') return 'classic'
  if (pref && pref !== 'auto') return pref
  return mapWeatherToGenshinPalette(currentWeather.value)
})
</script>

<style scoped>
.canvas-genshin-vista {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  user-select: none;
  transition: background 0.6s ease;
}

/* 1. Fontaine · Azure Cascade (图 1：澄澈苍蓝 → 云雾粉蓝 → 翡翠青绿水雾，纯柔和渐变无几何块) */
.canvas-genshin-vista.is-palette-fontaine {
  background:
    radial-gradient(ellipse 75% 45% at 50% 62%, rgba(226, 250, 255, 0.52) 0%, transparent 72%),
    radial-gradient(ellipse 65% 40% at 22% 24%, rgba(240, 250, 255, 0.36) 0%, transparent 68%),
    radial-gradient(ellipse 60% 42% at 78% 88%, rgba(94, 234, 212, 0.42) 0%, transparent 70%),
    linear-gradient(180deg, #6aa8f2 0%, #96caf9 28%, #cbeafa 54%, #84bce6 78%, #5adbd0 100%);
}

/* 2. Celestia · Dreamy Lavender-Peach Dusk (图 2：矢车菊蓝 → 丁香紫粉霞光 → 暖金天际 → 镜面柔蓝) */
.canvas-genshin-vista.is-palette-celestia {
  background:
    radial-gradient(ellipse 70% 32% at 52% 60%, rgba(254, 235, 184, 0.62) 0%, transparent 68%),
    radial-gradient(ellipse 60% 48% at 76% 32%, rgba(247, 208, 224, 0.56) 0%, transparent 70%),
    radial-gradient(ellipse 58% 44% at 22% 42%, rgba(226, 192, 240, 0.48) 0%, transparent 68%),
    linear-gradient(
      180deg,
      #739bf0 0%,
      #a8bff6 26%,
      #e4c3e6 50%,
      #fbe2b4 64%,
      #d6c2e8 82%,
      #88abed 100%
    );
}

/* 3. Mondstadt · Emerald Breeze (图 3：晴空天青蓝 → 远山雾青 → 湖水碧色 → 阳光草甸柔绿) */
.canvas-genshin-vista.is-palette-mondstadt {
  background:
    radial-gradient(ellipse 78% 36% at 50% 54%, rgba(190, 244, 252, 0.48) 0%, transparent 70%),
    radial-gradient(ellipse 55% 35% at 26% 26%, rgba(250, 238, 246, 0.34) 0%, transparent 66%),
    radial-gradient(ellipse 80% 38% at 50% 96%, rgba(132, 222, 74, 0.42) 0%, transparent 72%),
    linear-gradient(180deg, #2d82d6 0%, #64b2f5 28%, #a4defa 52%, #4ac2cd 75%, #72ce52 100%);
}

/* 4. Natlan · Terracotta & Sage Canyon (图 4：暮紫天际 → 暖杏云霭 → 赤陶暖橘与晴岚翠绿柔和交融) */
.canvas-genshin-vista.is-palette-natlan {
  background:
    radial-gradient(ellipse 56% 58% at 14% 48%, rgba(214, 120, 88, 0.46) 0%, transparent 68%),
    radial-gradient(ellipse 68% 38% at 52% 48%, rgba(246, 232, 212, 0.54) 0%, transparent 70%),
    radial-gradient(ellipse 65% 45% at 82% 84%, rgba(138, 178, 86, 0.46) 0%, transparent 70%),
    linear-gradient(180deg, #7c86ab 0%, #bab4c6 28%, #efe0cd 52%, #c6b89e 74%, #8cb05a 100%);
}

/* 5. Liyue · Golden Sunset (图 5：绯霞暮色 → 璀璨落日金辉 → 琥珀暖云 → 秋林暖翠) */
.canvas-genshin-vista.is-palette-liyue {
  background:
    radial-gradient(
      circle at 82% 28%,
      rgba(255, 252, 218, 0.78) 0%,
      rgba(255, 214, 132, 0.38) 34%,
      transparent 68%
    ),
    radial-gradient(ellipse 72% 42% at 48% 54%, rgba(255, 232, 168, 0.52) 0%, transparent 70%),
    radial-gradient(ellipse 75% 36% at 50% 95%, rgba(150, 168, 72, 0.44) 0%, transparent 72%),
    linear-gradient(180deg, #be8288 0%, #e6a082 26%, #fcc47e 52%, #ffe8a4 74%, #9db058 100%);
}

/* 6. Starry Night · Astral Galaxy (新图 1：深邃午夜蓝 → 璀璨青紫星云银河带 → 地平线荧光宝蓝) */
.canvas-genshin-vista.is-palette-starry_night {
  background:
    radial-gradient(
      ellipse 68% 24% at 52% 40%,
      rgba(72, 208, 255, 0.46) 0%,
      rgba(124, 92, 252, 0.24) 48%,
      transparent 76%
    ),
    radial-gradient(
      ellipse 46% 20% at 76% 34%,
      rgba(224, 212, 255, 0.38) 0%,
      rgba(88, 166, 255, 0.22) 45%,
      transparent 72%
    ),
    radial-gradient(ellipse 82% 28% at 50% 92%, rgba(56, 189, 248, 0.42) 0%, transparent 70%),
    linear-gradient(
      180deg,
      #070c24 0%,
      #0f1c4d 28%,
      #1b3578 52%,
      #1d56a8 76%,
      #2b8fd6 92%,
      #184775 100%
    );
}

/* 7. Twilight Dusk · Crimson Evening (新图 2：深靛蓝夜幕 → 暮紫晚霞 → 绯红珊瑚天际 → 幽谷暮霭) */
.canvas-genshin-vista.is-palette-twilight_dusk {
  background:
    radial-gradient(ellipse 64% 42% at 82% 48%, rgba(255, 108, 108, 0.48) 0%, transparent 68%),
    radial-gradient(ellipse 75% 28% at 56% 64%, rgba(255, 176, 152, 0.44) 0%, transparent 68%),
    radial-gradient(ellipse 70% 34% at 45% 88%, rgba(168, 156, 182, 0.32) 0%, transparent 70%),
    linear-gradient(
      180deg,
      #232b4a 0%,
      #463a5e 24%,
      #824b6c 46%,
      #df6b68 65%,
      #cba0a8 82%,
      #4a5264 100%
    );
}
</style>
