/** 检查器表单的小工具：取输入值 / 格式化秒数（各表单共用，免得每个文件再抄一遍） */

export function inputValue(e: Event): string {
  return (e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
}

export function numberValue(e: Event): number {
  return Number(inputValue(e))
}

export function fmtSec(sec: number | undefined): string {
  return Number.isFinite(sec) ? (sec as number).toFixed(2) : '0.00'
}
