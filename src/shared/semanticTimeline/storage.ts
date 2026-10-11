/**
 * Semantic Timeline 工程内存储布局（相对工程根）：
 *
 *   Semantic/<timelineId>/
 *     timeline.json
 *     evidence/
 *       shots.json
 *       utterances.json
 *       entities.json
 *       ocr.json
 *       keyframes/
 *       masks/
 *       stems/
 *
 * 注：`builds/<buildId>/manifest.json` 的布局随「按编辑列表裁剪原片」那条构建路删除；
 * 重建（生成片段 + 本地拼接）把自己的清单落在 `Semantic/<id>/rebuilds/<runId>/`
 * （见主进程 `graphBridge.semanticRebuildForGraph`）。
 */

export const SEMANTIC_ROOT_DIR = 'Semantic'
export const EVIDENCE_DIR = 'evidence'
export const KEYFRAMES_DIR = 'keyframes'
export const MASKS_DIR = 'masks'
export const STEMS_DIR = 'stems'

export const TIMELINE_FILE = 'timeline.json'
export const SHOTS_FILE = 'shots.json'
export const UTTERANCES_FILE = 'utterances.json'
export const ENTITIES_FILE = 'entities.json'
export const OCR_FILE = 'ocr.json'

export function semanticAssetDir(timelineId: string): string {
  return `${SEMANTIC_ROOT_DIR}/${timelineId}`
}

export function timelineJsonPath(timelineId: string): string {
  return `${semanticAssetDir(timelineId)}/${TIMELINE_FILE}`
}

export function evidenceDir(timelineId: string): string {
  return `${semanticAssetDir(timelineId)}/${EVIDENCE_DIR}`
}

export function evidenceFilePath(
  timelineId: string,
  file: typeof SHOTS_FILE | typeof UTTERANCES_FILE | typeof ENTITIES_FILE | typeof OCR_FILE
): string {
  return `${evidenceDir(timelineId)}/${file}`
}

export function keyframesDir(timelineId: string): string {
  return `${evidenceDir(timelineId)}/${KEYFRAMES_DIR}`
}

export function masksDir(timelineId: string): string {
  return `${evidenceDir(timelineId)}/${MASKS_DIR}`
}

export function stemsDir(timelineId: string): string {
  return `${evidenceDir(timelineId)}/${STEMS_DIR}`
}

/** 视频旁挂 `.asset.json` 上指向语义工程的字段名 */
export const VIDEO_SEMANTIC_TIMELINE_ID_KEY = 'semanticTimelineId'

/** 默认证据相对路径（写入 EvidenceIndex） */
export function defaultEvidencePaths(timelineId: string) {
  return {
    shotsPath: evidenceFilePath(timelineId, SHOTS_FILE),
    utterancesPath: evidenceFilePath(timelineId, UTTERANCES_FILE),
    entitiesPath: evidenceFilePath(timelineId, ENTITIES_FILE),
    ocrPath: evidenceFilePath(timelineId, OCR_FILE)
  }
}
