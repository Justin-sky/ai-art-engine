/**
 * 识别 dsh stdout / stderr 里 DeepSeek API 余额不足的提示词（中文 / 英文都覆盖）。
 * dsh 会把上游错误原样打印，常见形态有「QUOTA: Insufficient Balance」「insufficient_balance」「余额不足」「欠费」。
 * 命中即返回 true，用于让异常退出消息给出可操作指引，而不是含糊的「请重试」。
 *
 * 单独成模块：deepseekHarnessService.ts 引入了 electron，测试环境无法加载，
 * 这里保持纯函数 + 零依赖，可直接被 vitest 引用。
 */
export function isDshQuotaError(text: string): boolean {
  return /quota[:\s]?\s*insufficient|insufficient[_\s-]?balance|余额不足|账户余额|欠费/i.test(
    text
  )
}