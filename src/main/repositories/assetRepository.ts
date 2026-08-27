import { join } from 'path'
import type { AssetInfo } from '@shared/domain'
import { normalizeAssetType } from '@shared/domain'
import { fail } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import {
  removeAssetFromTree,
  scanAssetTree,
  writeAssetToTree
} from './assetTreeStore'

export class AssetRepository {
  list(root: string): AssetInfo[] {
    return this.listRaw(root)
      .map((asset) => this.normalize(asset))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  listRaw(root: string): AssetInfo[] {
    return scanAssetTree(root).assets
  }

  read(root: string, assetId: string): AssetInfo {
    const scan = scanAssetTree(root)
    const asset = scan.assets.find((a) => a.id === assetId)
    if (!asset) throw fail(MAIN_ERRORS.assetNotFound)
    return this.normalize(asset)
  }

  write(root: string, asset: AssetInfo): void {
    const scan = scanAssetTree(root)
    const mediaAbs = asset.relativePath?.trim() ? join(root, asset.relativePath) : null
    writeAssetToTree(root, this.normalize(asset), { scan, mediaAbs })
  }

  removeMetadata(root: string, assetId: string): void {
    removeAssetFromTree(root, assetId)
  }

  normalize(asset: AssetInfo): AssetInfo {
    const type = normalizeAssetType(asset.type as string)
    return type === asset.type ? asset : { ...asset, type }
  }
}

export const assetRepository = new AssetRepository()
