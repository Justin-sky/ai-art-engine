/** 将供应商原始错误整理为适合执行日志展示的文案（含常见排查提示） */
export function formatProviderErrorForLog(raw: string, locale?: string): string {
  const text = raw.trim()
  if (!text) return raw
  const isZh = !locale || String(locale).toLowerCase().startsWith('zh')
  if (/No allowed providers are available for the selected model/i.test(text)) {
    const hint = isZh
      ? '排查：打开 OpenRouter 设置，清空 Allowed Providers、取消 Ignored Providers 限制；并确认账户余额与所选模型可用。'
      : 'Troubleshoot: In OpenRouter settings, clear Allowed Providers and unblock Ignored Providers; also check credits and model availability.'
    return `${text}\n${hint}`
  }
  return text
}
