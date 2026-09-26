/**
 * 按部件操作时的部件名选择逻辑（补全 / 重拓扑 / 贴图 / 格式转换共用）。
 *
 * 部件名来自拆分后 GLB 的 node 名（见主进程 `glbParts.ts`），用户基本猜不出来，
 * 所以下游节点从上游拆分节点读出来做点选；点选结果同时回写卡片指令框文本，
 * 避免「点完再动一下指令框就把选择冲掉」。
 */

/** 切换某个部件是否入选（去重、保持追加顺序、trim） */
export function togglePartName(list: readonly string[], part: string): string[] {
  const name = part.trim()
  if (!name) return [...list]
  return list.includes(name) ? list.filter((item) => item !== name) : [...list, name]
}

/** 部件列表 → 指令框文本（与卡片里「逗号或换行分隔」的解析口径一致） */
export function joinPartNames(list: readonly string[]): string {
  return list.join(', ')
}
