import { app } from 'electron'
import { join } from 'node:path'

/**
 * dsh 的落盘路径。
 *
 * **为什么单独一个文件**：这两条路径被多个服务共用 —— 技能快照（`deepseekHarnessService`）
 * 与市场安装（`workflowMarketService`）必须用**同一个**技能目录，否则会出现「装进去了但
 * 快照不认」这类只在某些机器上复现的问题。
 *
 * 但不能因此让市场服务去 import `deepseekHarnessService`：后者引了 `virtual:` 开头的
 * 构建期模块，只有 Vite 打包时存在 —— 一旦被测试引用就会整个模块加载失败，
 * 连带把它下面的测试全带崩（实测 23 条）。所以把纯路径抽出来共享。
 */

/** dsh 配置根目录（userData 下，避免污染工程目录） */
export function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-harness')
}

/** dsh 技能目录（`$DSH_HOME/skills`）：dsh 的 `skill-filesystem` 会扫这一层，深度 1 */
export function dshSkillsDir(): string {
  return join(dshHome(), 'skills')
}
