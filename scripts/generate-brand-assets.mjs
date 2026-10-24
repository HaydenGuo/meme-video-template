// 一张 AI 源图派生导航、浏览器、搜索和移动设备图标；不分别绘制其它图案。
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export function generateBrandAssets({ source, root, brandName }) {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
  const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', source], { windowsHide: true }).toString())
  const image = probe.streams?.find((s) => s.codec_type === 'video')
  if (!image || image.codec_name !== 'png' || image.width !== image.height || image.width < 512) throw new Error('品牌源图必须是至少 512×512 的正方形 PNG')
  const directory = resolve(root, 'public/brand')
  mkdirSync(directory, { recursive: true })
  const canonical = resolve(directory, 'source.png')
  if (resolve(source) !== canonical) copyFileSync(source, canonical)
  const files = ['public/brand/source.png']
  const output = (name, input, size) => {
    execFileSync(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', input, '-vf', `scale=${size}:${size}:flags=lanczos`, '-frames:v', '1', resolve(directory, name)], { windowsHide: true })
    files.push(`public/brand/${name}`)
  }
  output('icon-512.png', canonical, 512)
  const normalized = resolve(directory, 'icon-512.png')
  for (const size of [16, 32, 48, 96, 180, 192]) output(`icon-${size}.png`, normalized, size)
  // ICO 内嵌同源 PNG 的 16/32/48px 版本，避免另造一套图标。
  const sizes = [16, 32, 48]
  const images = sizes.map((size) => readFileSync(resolve(directory, `icon-${size}.png`)))
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  for (let i = 0; i < sizes.length; i++) {
    const entry = 6 + i * 16
    header[entry] = sizes[i]; header[entry + 1] = sizes[i]
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12)
    offset += images[i].length
  }
  writeFileSync(resolve(root, 'public/favicon.ico'), Buffer.concat([header, ...images]))
  files.push('public/favicon.ico')
  writeFileSync(resolve(directory, 'site.webmanifest'), JSON.stringify({ name: brandName, short_name: brandName,
    icons: [192, 512].map((size) => ({ src: `/brand/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
    start_url: '/', display: 'browser' }, null, 2) + '\n')
  files.push('public/brand/site.webmanifest')
  const hashes = Object.fromEntries(files.map((file) => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')]))
  writeFileSync(resolve(directory, 'assets.json'), JSON.stringify({ source: '/brand/source.png', generatedAt: new Date().toISOString(), hashes }, null, 2) + '\n')
  files.push('public/brand/assets.json')
  return { files, branding: { icon: '/brand/icon-512.png', favicon: '/brand/icon-96.png', appleTouchIcon: '/brand/icon-180.png', manifest: '/brand/site.webmanifest' } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const source = args[args.indexOf('--source') + 1]
  if (!args.includes('--source') || !source || source.startsWith('--')) throw new Error('node scripts/generate-brand-assets.mjs --source <AI源图.png> [--brand <品牌名>]')
  const brandName = args.includes('--brand') ? args[args.indexOf('--brand') + 1] : 'Meme Video'
  console.log(JSON.stringify(generateBrandAssets({ source: resolve(source), root, brandName }), null, 2))
}
