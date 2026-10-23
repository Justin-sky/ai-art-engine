import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.join(root, 'assets')
const imgsDir = path.join(assetsDir, 'imgs')

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
cleanTemps(imgsDir)

// Logos stay in assets/
for (const file of fs.readdirSync(assetsDir).filter((f) => f.endsWith('.png') && f.startsWith('logo'))) {
  const input = path.join(assetsDir, file)
  const buf = fs.readFileSync(input)
  const before = buf.length
  const meta = await sharp(buf).metadata()
  const tmp = path.join(assetsDir, `.${file}.tmp`)
  await sharp(buf)
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

// Feature screenshots live in assets/imgs/ (always output as .webp)
if (!fs.existsSync(imgsDir)) {
  console.log('No assets/imgs directory; skip screenshot optimize.')
  process.exit(0)
}

const screenshots = fs
  .readdirSync(imgsDir)
  .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith('.'))

for (const file of screenshots) {
  const input = path.join(imgsDir, file)
  const buf = fs.readFileSync(input)
  const before = buf.length
  const meta = await sharp(buf).metadata()
  const baseName = file.replace(/\.(png|jpe?g|webp)$/i, '')
  const output = path.join(imgsDir, `${baseName}.webp`)
  const tmp = path.join(imgsDir, `.${baseName}.webp.tmp`)

  await sharp(buf)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 80, effort: 6, smartSubsample: true })
    .toFile(tmp)

  const after = fs.statSync(tmp).size
  if (input.toLowerCase() !== output.toLowerCase()) {
    replaceFile(tmp, output)
    fs.unlinkSync(input)
  } else if (after < before) {
    replaceFile(tmp, output)
  } else {
    fs.unlinkSync(tmp)
  }
  const finalSize = fs.statSync(output).size
  const outMeta = await sharp(output).metadata()
  console.log(
    `${path.basename(output).padEnd(28)} ${(before / 1024).toFixed(1)}KB -> ${(finalSize / 1024).toFixed(1)}KB (${meta.width}x${meta.height} -> ${outMeta.width}x${outMeta.height})`
  )
}
