import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * 解析 ffprobe `-show_entries frame=pts_time,key_frame -of csv=p=0` 输出，
 * 只保留 key_frame=1 的关键帧时间（秒）。
 */
export function parseKeyframeTimes(csv: string): number[] {
  const times: number[] = []
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const fields = line.split(',')
    const time = Number(fields[0]?.trim())
    const isKey = fields[1]?.trim() === '1'
    if (isKey && Number.isFinite(time) && time >= 0) times.push(time)
  }
  return [...new Set(times)].sort((a, b) => a - b)
}

/**
 * 用 ffprobe 探测视频关键帧（I 帧）时间列表。
 * 二进制来源：`FFPROBE_PATH` 环境变量 > 系统 PATH。
 * 无 ffprobe 或解析失败时返回 null（调用方回退逐帧生成）。
 */
export async function detectVideoKeyframes(
  fileAbs: string
): Promise<number[] | null> {
  const bin = process.env.FFPROBE_PATH?.trim() || 'ffprobe'
  try {
    const { stdout } = await execFileAsync(
      bin,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'frame=pts_time,key_frame',
        '-of',
        'csv=p=0',
        fileAbs
      ],
      {
        timeout: 20_000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
      }
    )
    const times = parseKeyframeTimes(stdout)
    return times.length ? times : null
  } catch {
    return null
  }
}
