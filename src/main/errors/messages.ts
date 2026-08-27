import { defErr, defErrSimple } from '@shared/errors/appError'

/**
 * main 进程服务 / 仓储 / 存储层的共享错误条目。
 * 仅 main 进程使用；assetPackage 完整性家族按 code 归组，其余个性文案在调用点内联。
 */
export const MAIN_ERRORS = {
  // ── 工程 / 文件系统基础 ──
  noProject: defErrSimple('project.noProject', '未打开工程', 'No project is open'),
  dirNotFound: defErrSimple('fs.dirNotFound', '目录不存在', 'Directory not found'),
  fileNotFound: defErrSimple('fs.fileNotFound', '媒体文件不存在', 'Media file not found'),
  assetNotFound: defErrSimple('asset.notFound', '资产不存在', 'Asset not found'),
  pathOutsideProject: defErrSimple(
    'fs.pathOutsideProject',
    '路径越界：操作必须在工程目录内',
    'Path out of bounds: operation must stay inside the project directory'
  ),

  // ── 资产包完整性（assetPackageArchive / assetPackageService）──
  packageEmptyEntries: defErrSimple(
    'assetPackage.emptyEntries',
    '资产包条目为空',
    'The asset package has no entries'
  ),
  packageTooLarge: defErrSimple(
    'assetPackage.tooLarge',
    '资产包过大',
    'The asset package is too large'
  ),
  packageTooManyEntries: defErrSimple(
    'assetPackage.tooManyEntries',
    '资产包条目过多',
    'The asset package contains too many entries'
  ),
  packageTooManyOutputs: defErrSimple(
    'assetPackage.tooManyOutputs',
    '资产包生成产物过多',
    'The asset package contains too many generated outputs'
  ),
  packageMissingManifest: defErrSimple(
    'assetPackage.missingManifest',
    '缺少 manifest.json',
    'manifest.json is missing'
  ),
  packageUnknownFormat: defErr<{ format: string }>(
    'assetPackage.unknownFormat',
    ({ format }) => `未知资产包格式: ${format}`,
    ({ format }) => `Unknown asset package format: ${format}`
  ),
  packageUnsupportedVersion: defErr<{ version: string }>(
    'assetPackage.unsupportedVersion',
    ({ version }) => `不支持的资产包版本: ${version}`,
    ({ version }) => `Unsupported asset package version: ${version}`
  ),
  packageIncompleteEntry: defErr<{ guid: string }>(
    'assetPackage.incompleteEntry',
    ({ guid }) => `包条目不完整: ${guid}`,
    ({ guid }) => `Incomplete package entry: ${guid}`
  ),
  packageMetaMismatch: defErr<{ guid: string }>(
    'assetPackage.metaMismatch',
    ({ guid }) => `meta 与 manifest 不一致: ${guid}`,
    ({ guid }) => `Metadata does not match manifest: ${guid}`
  )
}
