/**
 * 模型下载地址的准入判断（主进程与单测共用）。
 *
 * 为什么需要它：人脸两段式模型托管在本仓 GitHub Release，tag 会随版本变化，所以允许
 * 渲染层把最终地址作为 `sourceUrl` 传给主进程（改 tag 不必重新打包）。但主进程不能因此
 * 变成「任意 URL 下载器」——只放行自家 Release 会用到的主机。
 *
 * GitHub Release 的资产地址会 302 到 `objects.githubusercontent.com`（旧）或
 * `release-assets.githubusercontent.com`（新），三处都要在名单里，否则下载会被自己的
 * 白名单拦掉。
 */

/** 允许的下载主机（https + 名单内） */
export const YOLO_DOWNLOAD_ALLOWED_HOSTS: readonly string[] = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'codeload.github.com'
]

/** 该地址是否允许作为模型下载源 */
export function isAllowedYoloDownloadUrl(raw: string): boolean {
  const value = raw?.trim()
  if (!value) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    return YOLO_DOWNLOAD_ALLOWED_HOSTS.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}
