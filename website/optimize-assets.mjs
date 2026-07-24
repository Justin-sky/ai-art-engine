import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.join(root, 'assets')
const bannerDir = path.join(assetsDir, 'banner')

function replaceFile(from, to) {
  fs.copyFileSync(from, to)
  fs.unlinkSync(from)
}

function cleanTemps(dir) {
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.') && f.endsWith('.tmp')) fs.unlinkSync(path.join(dir, f))
  }
}

cleanTemps(assetsDir)
cleanTemps(bannerDir)

// Logos stay in assets/
for (const file of fs.readdirSync(assetsDir).filter((f) => f.endsWith('.png') && f.startsWith('logo'))) {
  const input = path.join(assetsDir, file)
  const before = fs.statSync(input).size
  const meta = await sharp(input).metadata()
  const tmp = path.join(assetsDir, `${file}.tmp`)
  await sharp(input)
    .rotate()
    .resize({
      width: file === 'logo-mark.png' ? 256 : 720,
      withoutEnlargement: true
    })
    .png({ compressionLevel: 9, effort: 10, palette: true, quality: 80, colors: 160 })
    .toFile(tmp)
  const after = fs.statSync(tmp).size
  if (after < before) replaceFile(tmp, input)
  else fs.unlinkSync(tmp)
  const final = fs.statSync(input).size
  console.log(
    `${file.padEnd(28)} ${(before / 1024).toFixed(1)}KB -> ${(final / 1024).toFixed(1)}KB (${meta.width}x${meta.height})`
  )
}

// Screenshots live in assets/banner/
if (!fs.existsSync(bannerDir)) {
  console.log('No assets/banner directory; skip screenshot optimize.')
  process.exit(0)
}

const screenshots = fs
  .readdirSync(bannerDir)
  .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith('.'))

for (const file of screenshots) {
  const input = path.join(bannerDir, file)
  const before = fs.statSync(input).size
  const meta = await sharp(input).metadata()
  const webpPath = path.join(bannerDir, file.replace(/\.(png|jpe?g|webp)$/i, '.webp'))
  const tmp = `${webpPath}.tmp`

  await sharp(input)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 78, effort: 6 })
    .toFile(tmp)

  const webpSize = fs.statSync(tmp).size
  replaceFile(tmp, webpPath)
  if (!/\.webp$/i.test(file) && path.resolve(input) !== path.resolve(webpPath)) {
    fs.unlinkSync(input)
  }
  console.log(
    `${file.padEnd(28)} ${(before / 1024).toFixed(1)}KB -> WebP ${(webpSize / 1024).toFixed(1)}KB (${meta.width}x${meta.height})`
  )
}
