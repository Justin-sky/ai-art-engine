/**
 * 声源分离（人声 / 伴奏）纯函数层。
 * MiniMax 等生成模型未开放专用分离接口，这里提供两级能力：
 * 1. 内置基础分离：ffmpeg 中置 / 侧置声道提取（对白 / 人声通常立体声居中，
 *    中置声道 (L+R)/2 近似人声，侧声道 (L-R)/2 近似伴奏），免费、本地、即时；
 * 2. 第三方 AI 分离接入位：配置 `AUDIO_SEPARATION_API_URL` 后改走第三方服务
 *    （POST 原始音频 → JSON `{ vocal, instrumental }` 下载地址），协议解析在此。
 */
export type AudioStemKind = 'vocal' | 'instrumental'

/** 中置声道提取（人声近似）：(L+R)/2 */
export const VOCAL_PAN_FILTER = 'pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1'

/** 侧声道提取（伴奏近似）：(L-R)/2，抵消居中的人声 */
export const INSTRUMENTAL_PAN_FILTER = 'pan=stereo|c0=0.5*c0-0.5*c1|c1=0.5*c1-0.5*c0'

/** 单声道 / 双声道同相（L≈R）回退滤镜：避免 (L-R)/2 相消成全静音，改用语音频段带通 / 陷波分离 */
export const MONO_VOCAL_BAND_FILTER = 'highpass=f=130,lowpass=f=3600'
export const MONO_INSTRUMENTAL_BAND_FILTER =
  'equalizer=f=320:t=q:w=1.1:g=-11,equalizer=f=1150:t=q:w=1.0:g=-14,equalizer=f=2600:t=q:w=1.2:g=-11'

export function buildAudioSeparationFilter(kind: AudioStemKind, monoFallback = false): string {
  if (monoFallback) {
    return kind === 'vocal' ? MONO_VOCAL_BAND_FILTER : MONO_INSTRUMENTAL_BAND_FILTER
  }
  return kind === 'vocal' ? VOCAL_PAN_FILTER : INSTRUMENTAL_PAN_FILTER
}

/** 分离产物文件名（落 `Cache/Separated/<stem>/` 下） */
export function buildAudioSeparationOutputName(kind: AudioStemKind): string {
  return `${kind}.wav`
}

/** 第三方分离服务响应协议：`{ vocal?: string; instrumental?: string }`（http(s) 或 data: URL） */
export interface ThirdPartySeparationBody {
  vocal?: string
  instrumental?: string
}

export function parseThirdPartySeparationResponse(body: unknown): {
  vocal?: string
  instrumental?: string
} {
  if (!body || typeof body !== 'object') return {}
  const record = body as Record<string, unknown>
  const vocal =
    typeof record.vocal === 'string' && record.vocal.trim() ? record.vocal.trim() : undefined
  const instrumental =
    typeof record.instrumental === 'string' && record.instrumental.trim()
      ? record.instrumental.trim()
      : undefined
  return { vocal, instrumental }
}
