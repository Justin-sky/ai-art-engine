import { app } from 'electron'
import { join } from 'node:path'

/**
 * Agent 运行时持久化与技能落盘路径。
 *
 * **为什么单独一个文件**：这两条路径被多个服务共用 —— Agent 运行时（`piHarnessService`）
 * 与技能市场安装（`skillMarketService`）必须用**同一个**技能目录，否则会出现「装进去了但
 * 快照不认」的问题。将纯路径抽成独立模块以保持低耦合。
 */

/** Agent 配置与会话根目录（userData 下，避免污染工程目录） */
export function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-harness')
}

/** 技能目录（`$DSH_HOME/skills`）：扫描深度 1 */
export function dshSkillsDir(): string {
  return join(dshHome(), 'skills')
}
