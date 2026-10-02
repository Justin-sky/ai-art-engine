#!/usr/bin/env node
/**
 * 工作区完整性级别修复入口（命令行）：把会阻断可执行程序的「低完整性」标签重置为「中等」。
 *
 * 背景与判断逻辑见 scripts/lib/integrity-label.mjs；修复编排见 scripts/lib/repair-integrity.mjs。
 * dev-launcher 启动前调用的是同一份实现，避免两处逻辑漂移。
 *
 * 用法：
 *   npm run fix:integrity                 # 重置工作区根目录 + electron 解包目录
 *   npm run fix:integrity -- --check      # 只查看当前标签，不做修改
 *   npm run fix:integrity -- --only=dist  # 只处理 electron 解包目录
 */
import { main } from './lib/repair-integrity.mjs'

process.exit(main())
