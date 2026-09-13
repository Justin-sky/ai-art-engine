import { execFile } from 'child_process'
import { promisify } from 'util'
import { findFfprobeBin } from './videoFrameService'

const execFileAsync = promisify(execFile)

/**
 * 解析 ffprobe `-show_entries frame=pts_time,key_frame -of csv=p=0` 输出，
 * 只保留 key_frame=1 的关键帧时间（秒）。
 *
 * 不依赖列顺序：ffprobe 9.x 实测输出 key_frame 在前（`1,0.000000,`），
 * 旧版本可能是 pts_time 在前（`0.000000,1`）——通过「0/1 整数值 = key_frame 标志、
 * 非负浮点 = 时间」启发式区分，两者均能正确解析。
 */
export function parseKeyframeTimes(csv: string): number[] {
  const times: number[] = []
  const isKeyFlag = (s: string): boolean => s === '0' || s === '1'
  for (const raw of csv.split(/\r?\n/)) {
    const fields = raw
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
    if (fields.length < 2) continue
    const keyIdx = fields.findIndex(isKeyFlag)
    if (keyIdx === -1) continue
    const timeField = fields.find((f, i) => i !== keyIdx && Number.isFinite(Number(f)))
    if (!timeField) continue
    const time = Number(timeField)
    if (fields[keyIdx] === '1' && Number.isFinite(time) && time >= 0) times.push(time)
  }
  return [...new Set(times)].sort((a, b) => a - b)
}

/**
 * 用 ffprobe 探测视频关键帧（I 帧）时间列表。
 * 二进制来源与 `videoFrameService.findFfprobeBin` 保持一致：
 * `FFPROBE_PATH` > 随包内置 `<resources>/ffmpeg/` > 应用私有安装目录 > 系统 PATH。
 * 无 ffprobe 或解析失败时返回 null（调用方回退逐帧生成）。
 */
export async function detectVideoKeyframes(fileAbs: string): Promise<number[] | null> {
  const bin = findFfprobeBin()
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
