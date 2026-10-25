#!/usr/bin/env node
// 安装模板后的统一初始化入口。先在暂存目录准备全部文件，再落盘；不发布、不创建云资源。
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, unlinkSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { generateBrandAssets } from './generate-brand-assets.mjs'
import { launchVars, patchWranglerVars } from './launch-config.mjs'
import { assetDimensions, ASSET_PIXELS } from '../services/hypit-bridge/src/media-preflight.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const usage = 'npm run site:init -- --profile <梗资料.json> [--services <本机公共配置.json>] [--apply] [--local]'
if (args.includes('--help')) { console.log(usage); process.exit(0) }
const permitted = new Set(['--profile', '--services', '--apply', '--local'])
for (let i = 0; i < args.length; i++) {
  if (!permitted.has(args[i])) throw new Error(`未知参数：${args[i]}`)
  if (['--profile', '--services'].includes(args[i])) {
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('参数缺少文件路径')
    i++
  }
}
const option = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined
const apply = args.includes('--apply')
const local = args.includes('--local')
if (local && !apply) throw new Error('--local 需要同时提供 --apply')
if (!option('--profile')) throw new Error(usage)
const profilePath = resolve(option('--profile'))
const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
const launch = profile.launch ?? 'local'
const features = launchVars(launch)
const services = option('--services') ? JSON.parse(readFileSync(resolve(option('--services')), 'utf8')) : {}
const digest = (value) => createHash('sha256').update(value).digest('hex')
const text = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 10000) throw new Error(`请填写 ${name}`)
  return value.trim()
}
const keyword = text(profile.keyword, 'keyword')
const slug = text(profile.slug, 'slug')
if (!/^[a-z][a-z0-9-]{1,48}$/.test(slug)) throw new Error('slug 需以小写字母开头，只包含小写字母、数字和短横线，长度 2–49')
const domain = profile.domain ?? `${slug}.example.com`
if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) throw new Error('domain 只填域名，不含协议和路径')
const port = profile.port ?? 3000
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port 应为 1024–65535')
const overview = { en: text(profile.overview?.en, 'overview.en'), zh: text(profile.overview?.zh, 'overview.zh') }
const trendArticle = profile.trendArticle ?? null
if (trendArticle !== null) {
  for (const locale of ['en', 'zh']) {
    const article = trendArticle[locale]
    if (!article || typeof article !== 'object' || Array.isArray(article)) throw new Error(`trendArticle.${locale} 必须提供完整文章`)
    text(article.title, `trendArticle.${locale}.title`)
    text(article.description, `trendArticle.${locale}.description`)
    text(article.intro, `trendArticle.${locale}.intro`)
    if (!Array.isArray(article.sections) || article.sections.length < 4 || article.sections.length > 10) throw new Error(`trendArticle.${locale}.sections 需要 4–10 个不同主题的小节`)
    for (const [index, section] of article.sections.entries()) {
      text(section?.h, `trendArticle.${locale}.sections[${index}].h`)
      if (!Array.isArray(section.p) || section.p.length < 1 || section.p.length > 5) throw new Error(`trendArticle.${locale}.sections[${index}].p 需要 1–5 段正文`)
      section.p.forEach((paragraph, paragraphIndex) => text(paragraph, `trendArticle.${locale}.sections[${index}].p[${paragraphIndex}]`))
    }
  }
}
const trendSources = profile.trendSources ?? []
if (!Array.isArray(trendSources) || trendSources.length > 20) throw new Error('trendSources 需要是 0–20 条来源的数组')
const validatedTrendSources = trendSources.map((source, index) => {
  const url = text(source?.url, `trendSources[${index}].url`)
  let parsedUrl
  try { parsedUrl = new URL(url) } catch { throw new Error(`trendSources[${index}].url 无效`) }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) throw new Error(`trendSources[${index}].url 必须是 HTTPS 公共网页`)
  return { url, name: { en: text(source?.name?.en, `trendSources[${index}].name.en`), zh: text(source?.name?.zh, `trendSources[${index}].name.zh`) } }
})
let heroVideo = null
if (profile.heroVideo != null) {
  if (!profile.heroVideo || typeof profile.heroVideo !== 'object' || Array.isArray(profile.heroVideo)) throw new Error('heroVideo 必须是对象')
  const videoId = text(profile.heroVideo.videoId, 'heroVideo.videoId')
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('heroVideo.videoId 必须是 11 位 YouTube 视频 ID')
  const playlistId = profile.heroVideo.playlistId == null ? undefined : text(profile.heroVideo.playlistId, 'heroVideo.playlistId')
  const startAt = profile.heroVideo.startAt ?? 0
  if (!Number.isInteger(startAt) || startAt < 0 || startAt > 86400) throw new Error('heroVideo.startAt 必须是 0–86400 的整数秒数')
  heroVideo = { videoId, ...(playlistId ? { playlistId } : {}), ...(startAt ? { startAt } : {}) }
}
const credit = text(profile.media?.credit, 'media.credit')
if (profile.media?.authorized !== true) throw new Error('请确认素材可用于本站：media.authorized=true')
const media = Object.fromEntries(['sourceVideo', 'exampleVideo', 'photo'].map((key) => {
  const path = resolve(dirname(profilePath), text(profile.media[key], `media.${key}`))
  if (!statSync(path).isFile()) throw new Error(`素材不是文件：${key}`)
  return [key, path]
}))
if (profile.media.brandIcon) {
  media.brandIcon = resolve(dirname(profilePath), text(profile.media.brandIcon, 'media.brandIcon'))
  if (!statSync(media.brandIcon).isFile()) throw new Error('品牌源图不是文件')
}
const brand = profile.brandName ?? `${keyword} AI`
text(brand, 'brandName')
const supportEmail = profile.supportEmail ?? `support@${domain}`
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) throw new Error('客服邮箱格式无效')
const origin = `http://127.0.0.1:${port}`
const templateId = `${slug}-v1`
const durations = profile.durations ?? [5, 12, 15]
if (!Array.isArray(durations) || durations.length !== 3 || durations.some((n, i) => !Number.isInteger(n) || n < 4 || n > 15 || (i > 0 && n <= durations[i - 1]))) throw new Error('durations 需要三个递增的整数秒数，范围 4–15')
const fullSeconds = durations.at(-1)
const aspectRatio = profile.aspectRatio ?? '9:16'
if (!['9:16', '16:9'].includes(aspectRatio)) throw new Error('aspectRatio 只支持 9:16 或 16:9')
const workflow = profile.workflow ?? null
if (workflow && (workflow.type !== 'reference-remix-v1' || !Array.isArray(workflow.cutFrames) || workflow.cutFrames[0] !== 0 || workflow.cutFrames.some((n, i) => !Number.isInteger(n) || n < 0 || n >= fullSeconds * 30 || (i > 0 && n <= workflow.cutFrames[i - 1])))) throw new Error('workflow 需要 reference-remix-v1 及以 0 开始的递增 cutFrames（30fps）')
const envNames = {
  googleClientId: ['GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_ID'],
  googleClientSecret: ['GOOGLE_CLIENT_SECRET', 'AUTH_GOOGLE_SECRET'],
  hypitBridgeToken: ['HYPIT_BRIDGE_TOKEN'],
}
// 公共配置只保存环境变量名称，不保存密钥正文。
const credentials = {}
for (const [key, fallbacks] of Object.entries(envNames)) {
  const names = services[`${key}Env`] ? [services[`${key}Env`]] : fallbacks
  if (names.some((name) => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name))) throw new Error('密钥环境变量名称无效')
  credentials[key] = names.map((name) => process.env[name]?.trim()).find(Boolean) ?? ''
}
if (Boolean(credentials.googleClientId) !== Boolean(credentials.googleClientSecret)) throw new Error('Google Client ID 与 Secret 需要同时提供')
if (credentials.hypitBridgeToken && credentials.hypitBridgeToken.length < 32) throw new Error('Bridge Token 至少 32 字符')
const bridgeUrl = services.hypitBridgeUrl ?? 'http://127.0.0.1:8788'
const bridge = new URL(bridgeUrl)
if (bridge.pathname !== '/' || bridge.search || bridge.hash || bridge.username || bridge.password ||
    !(bridge.protocol === 'https:' || (bridge.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(bridge.hostname)))) throw new Error('Bridge 地址必须是 HTTPS origin 或本地回环 HTTP origin')
const privateKeys = new Set(['googleClientIdEnv', 'googleClientSecretEnv', 'hypitBridgeTokenEnv', 'hypitBridgeUrl', 'adminEmail'])
if (Object.keys(services).some((key) => !privateKeys.has(key))) throw new Error('公共配置包含不支持的字段；凭据请通过环境变量提供')
const adminEmail = services.adminEmail ?? profile.supportEmail ?? `support@${domain}`
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('管理员邮箱格式无效')
const fingerprint = digest(JSON.stringify({ profile, services, media: Object.fromEntries(Object.entries(media).map(([key, path]) => [key, digest(readFileSync(path))])) }))
const statePath = join(root, '.site-initialized.json')
if (existsSync(statePath)) {
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  if (state.fingerprint === fingerprint) {
    console.log('该站点已初始化，相同输入不重复覆盖。更换凭据请编辑私有环境配置；补跑本地迁移和媒体导入请运行 npm run seed:local。')
    process.exit(0)
  }
  throw new Error('该目录已经初始化，拒绝覆盖已有站点。请在新的模板副本中初始化。')
}
const pending = [
  `Google OAuth Web 客户端 Authorized JavaScript origins 登记 ${origin}、https://${domain} 和 https://www.${domain}（按实际访问域名取用）；Authorized redirect URI 登记 https://${domain}/api/auth/google/callback`,
  '创建并绑定各站独立 D1、KV、R2 和 Queue；配置正式域名及生产服务商',
  '创建 25/$9.90 与 60/$19.90 的一次性支付商品并登记 webhook',
  '配置真实邮件域名、图片审核及 Turnstile；生产前运行 doctor 并完成登录/充值/生成验证',
  '人工审阅梗资料、翻译、指南和展示素材；脚本不代表 SEO 或真实生成验收通过',
]
pending.push(`当前上线阶段：${launch}。仅核验已开放功能；关闭新购买时保留已有支付回调与凭据`)
if (!credentials.googleClientId) pending.push('尚未配置 Google；开启登录前需接通 Google 或已验证发件域的邮箱注册。本地开发可使用调试登录')
pending.push('将生成的 Bridge 站点片段合并进 VPS Bridge 配置并重启；复核模型预算后才运行真实生成')
if (domain.endsWith('.example.com')) pending.push('当前域名为占位值，上线前替换正式域名及相关回调/发件地址')
console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', keyword, slug, domain, launch, features, localUrl: origin,
  assets: Object.keys(media), durations, packages: ['25 / $9.90', '60 / $19.90'],
  googleConfigured: Boolean(credentials.googleClientId), bridgeConfigured: Boolean(credentials.hypitBridgeToken), pending }, null, 2))
if (!apply) { console.log('\n仅预览，未写文件。确认资料后加 --apply；加 --local 导入本地数据库与素材。'); process.exit(0) }

// fresh clone 可以有输入文件；拒绝覆盖已修改的跟踪文件和私有运行状态。
const run = (bin, argv, cwd = root, stdio = 'pipe') => execFileSync(bin, argv, { cwd, stdio, windowsHide: true })
if (run('git', ['status', '--porcelain', '--untracked-files=no']).toString().trim()) throw new Error('跟踪文件已有修改，请在干净的模板副本中初始化')
for (const path of ['.dev.vars', '.dev.vars.local', '.wrangler', 'public/site-init', 'seed/site-init']) {
  if (existsSync(join(root, path))) throw new Error(`已有配置或运行状态，拒绝覆盖：${path}`)
}
const commit = run('git', ['rev-parse', 'HEAD']).toString().trim()
const lockPath = join(root, '.site-init.lock')
writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
process.on('exit', () => { if (existsSync(lockPath)) unlinkSync(lockPath) })
const stage = join(root, '.tmp', 'site-init', randomBytes(8).toString('hex'))
const files = new Set(['scripts/new-site.mjs', 'src/config/site.ts', 'src/content/en.ts', 'src/content/zh.ts', 'wrangler.jsonc', 'package.json', 'package-lock.json'])
for (const file of files) {
  mkdirSync(dirname(join(stage, file)), { recursive: true })
  copyFileSync(join(root, file), join(stage, file))
}
// 旧脚手架以正则替换字符串，先只传受限的站点标识；自由文本随后用 AST/JSON 安全写入。
run(process.execPath, [join(stage, 'scripts/new-site.mjs'), '--keyword', slug, '--domain', domain, '--slug', slug,
  '--name', slug, '--brand', slug, '--email', `support@${domain}`, '--platform', 'TikTok', '--write'], stage)

// 使用 TypeScript 语法树精确定位属性，模板结构变化时停止；不用全局替换用户文案。
function editObject(file, kind, edits) {
  let source = readFileSync(join(stage, file), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const unwrap = (node) => { while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))) node = node.expression; return node }
  let object
  if (kind === 'site') {
    for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) if (decl.name.getText(ast) === 'site') object = unwrap(decl.initializer)
    }
  } else {
    const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === kind)
    object = unwrap(fn?.body?.statements.find(ts.isReturnStatement)?.expression)
  }
  const replacements = []
  for (const [path, value] of Object.entries(edits)) {
    let node = object
    for (const key of path.split('.')) {
      if (!node || !ts.isObjectLiteralExpression(node)) throw new Error(`${file}: 无法定位 ${path}`)
      const found = node.properties.filter((p) => ts.isPropertyAssignment(p) && p.name.getText(ast).replace(/^['"]|['"]$/g, '') === key)
      if (found.length !== 1) throw new Error(`${file}: 属性不唯一 ${path}`)
      node = unwrap(found[0].initializer)
    }
    replacements.push({ start: node.getStart(ast), end: node.end, value: JSON.stringify(value, null, 2) })
  }
  replacements.sort((a, b) => b.start - a.start)
  for (const item of replacements) source = source.slice(0, item.start) + item.value + source.slice(item.end)
  writeFileSync(join(stage, file), source)
}

function setTrendSources(sources) {
  if (!sources.length) return
  const file = 'src/config/site.ts'
  let source = readFileSync(join(stage, file), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const unwrap = (node) => { while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))) node = node.expression; return node }
  let siteObject
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
    for (const decl of statement.declarationList.declarations) if (decl.name.getText(ast) === 'site') siteObject = unwrap(decl.initializer)
  }
  const property = (object, name) => object?.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(ast).replace(/^['"]|['"]$/g, '') === name)
  const articles = unwrap(property(siteObject, 'articles')?.initializer)
  const trend = articles && ts.isArrayLiteralExpression(articles)
    ? articles.elements.find((item) => ts.isObjectLiteralExpression(item) && property(item, 'key')?.initializer.getText(ast).replace(/^['"]|['"]$/g, '') === 'trend')
    : null
  if (!trend || !ts.isObjectLiteralExpression(trend)) throw new Error(`${file}: 无法定位 trend 文章配置`)
  const existing = property(trend, 'sources')
  if (existing) {
    const value = unwrap(existing.initializer)
    source = source.slice(0, value.getStart(ast)) + JSON.stringify(sources, null, 2) + source.slice(value.end)
  } else {
    const insertionPoint = trend.end - 1
    const before = source.slice(0, insertionPoint)
    const separator = before.trimEnd().endsWith(',') ? '' : ','
    source = before + `${separator}\n      sources: ${JSON.stringify(sources, null, 6).replaceAll('\n', '\n      ')},` + source.slice(insertionPoint)
  }
  writeFileSync(join(stage, file), source)
}

const assetDir = 'public/site-init'
mkdirSync(join(stage, assetDir), { recursive: true })
mkdirSync(join(stage, 'seed/templates'), { recursive: true })
// ffmpeg/ffprobe 来自本机安装；路径可通过环境变量指定。不下载或执行用户提供的命令。
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe'
run(ffmpeg, ['-version'])
const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', media.sourceVideo]).toString())
if (Number(probe.format?.duration) + 0.001 < fullSeconds || !Number.isFinite(Number(probe.format?.duration)) || !probe.streams?.some((s) => s.codec_type === 'video')) throw new Error(`源视频必须包含视频流且至少 ${fullSeconds} 秒`)
if (workflow && !probe.streams.some((s) => s.codec_type === 'audio')) throw new Error('原声合成模板需要参考片包含音轨')
const ff = (argv) => run(ffmpeg, ['-v', 'error', '-nostdin', '-y', ...argv])
const videoOut = (input, output, seconds) => {
  const info = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', input]).toString())
  const stream = info.streams?.find(s => s.codec_type === 'video')
  const rotation = Number(stream?.side_data_list?.find(s => s.rotation != null)?.rotation ?? stream?.tags?.rotate ?? 0)
  const swap = Math.abs(rotation % 180) === 90
  const size = assetDimensions(swap ? stream?.height : stream?.width, swap ? stream?.width : stream?.height)
  const target = join(stage, output)
  ff(['-i', input, '-t', String(seconds), '-vf', `scale=${size.width}:${size.height}:flags=lanczos,setsar=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', target])
  const result = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', target]).toString()).streams?.find(s => s.codec_type === 'video')
  if (!result || result.width * result.height < ASSET_PIXELS.min || result.width * result.height > ASSET_PIXELS.max) throw new Error('模板视频像素数不符合模型要求')
}
videoOut(media.sourceVideo, `${assetDir}/original.mp4`, fullSeconds)
videoOut(media.exampleVideo, `${assetDir}/ai.mp4`, fullSeconds)
for (const seconds of durations) {
  const file = `seed/templates/${templateId}-${seconds}s.mp4`
  videoOut(media.sourceVideo, file, seconds)
  files.add(file)
}
for (const key of ['original', 'ai']) ff(['-i', join(stage, assetDir, `${key}.mp4`), '-frames:v', '1', join(stage, assetDir, `${key}.jpg`)])
ff(['-i', media.photo, '-frames:v', '1', join(stage, assetDir, 'photo.jpg')])
ff(['-i', media.photo, '-vf', 'scale=1200:630:force_original_aspect_ratio=decrease,pad=1200:630:(ow-iw)/2:(oh-ih)/2', '-frames:v', '1', join(stage, assetDir, 'og.png')])
for (const file of ['original.mp4', 'ai.mp4', 'original.jpg', 'ai.jpg', 'photo.jpg', 'og.png']) files.add(`${assetDir}/${file}`)
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#ec2776"/><path d="M26 17v30l24-15z" fill="white"/></svg>'
writeFileSync(join(stage, 'public/favicon.svg'), svg)
files.add('public/favicon.svg')
const brandAssets = media.brandIcon ? generateBrandAssets({ source: media.brandIcon, root: stage, brandName: brand }) : null
for (const file of brandAssets?.files ?? []) files.add(file)
const sample = { photo: '/site-init/photo.jpg', video: '/site-init/ai.mp4', poster: '/site-init/ai.jpg' }
editObject('src/config/site.ts', 'site', {
  keyword, brandName: brand, supportEmail, trendPlatform: text(profile.platform ?? 'TikTok', 'platform'),
  logoMark: profile.logoMark ?? slug.split('-').map((word) => word[0]).join('').slice(0, 2).toUpperCase(),
  keywordOverview: overview, ogImage: '/site-init/og.png',
  branding: brandAssets?.branding ?? null,
  'template.fullSeconds': fullSeconds, 'template.aspectRatio': aspectRatio,
  'seo.secondaryKeywords': [`${keyword} AI`, `${keyword} video`, `${keyword} meme`],
  examples: { original: { video: '/site-init/original.mp4', poster: '/site-init/original.jpg', credit, youtube: heroVideo },
    aiVersions: [{ video: sample.video, poster: sample.poster, credit }], madeWith: sample, additional: [], gallery: [], ideas: [sample, sample, sample] },
  durations: durations.map((seconds, i) => ({ id: ['short', 'medium', 'full'][i], seconds, credits: seconds,
    source: `${templateId}-${seconds}s.mp4`, ...(seconds === fullSeconds ? { isFull: true } : {}) })),
  packages: [{ id: 'starter', credits: 25, priceCents: 990, currency: 'USD' }, { id: 'party', credits: 60, priceCents: 1990, currency: 'USD', highlight: true }],
  subscriptionsEnabled: false, 'video.hypit.templateId': templateId,
})
for (const locale of ['en', 'zh']) {
  const zh = locale === 'zh'
  const intro = overview[locale].replaceAll('{keyword}', keyword)
  const lengths = durations.join(' / ')
  const about = zh ? `上传一张照片，制作自己的 ${keyword} 梗视频。选择 ${lengths} 秒，以及横版或竖版，生成后下载分享。` : `Upload a photo to make your own ${keyword} meme video. Choose ${lengths} seconds and portrait or landscape, then generate and download.`
  const generatedTrend = zh ? {
    title: `${keyword} 是什么？`, description: intro, intro,
    sections: [
      { h: '视频里发生了什么', p: [intro] },
      { h: '这个梗如何被复刻', p: ['复刻时先识别原片最容易辨认的动作、节奏和构图，再决定哪些元素需要保留。不同版本可以替换主角或场景，但不要把推测的起源、日期或热度数据写成事实。'] },
      { h: 'AI 版本如何制作', p: [about, '本页生成器使用配置的参考视频和一张照片制作新版本。选择时长前先查看首屏参考片；提交前确认照片属于本人或已经取得人物许可。'] },
      { h: '发布前检查', p: ['清楚标注 AI 生成，尊重原作者和人物授权；音乐、片段和肖像的使用范围应按各自平台规则核实。'] },
    ],
  } : {
    title: `What is ${keyword}?`, description: intro, intro,
    sections: [
      { h: 'What happens in the clip', p: [intro] },
      { h: 'How the format is remixed', p: ['Identify the movement, rhythm and framing that make the source recognisable, then decide what a remake should preserve. A version can change the featured person or setting; do not present an unverified origin, date or view count as fact.'] },
      { h: 'How an AI version is made', p: [about, 'This site uses its configured reference video and one photo to create a new version. Preview the reference clip before choosing a length, and use a photo of yourself or someone who has given permission.'] },
      { h: 'Before sharing', p: ['Label the result as AI-generated, respect creator and likeness permissions, and check the applicable platform rules for music and footage.'] },
    ],
  }
  const trend = trendArticle?.[locale] ?? generatedTrend
  const guide = { title: zh ? `如何制作 ${keyword} AI 视频` : `How to make a ${keyword} AI video`, description: about, intro: about,
    sections: zh ? [
      { h: '1. 准备照片', p: ['使用清晰的单人照片，确保照片是本人或已获人物许可。'] },
      { h: '2. 选择时长和比例', p: [`可选 ${lengths} 秒，每秒 1 积分；竖版 9:16 或横版 16:9。`] },
      { h: '3. 生成并下载', p: ['登录后确认授权并提交，完成后下载 MP4；分享时注明 AI 生成。'] },
    ] : [
      { h: '1. Prepare a photo', p: ['Use a clear photo of one person, with permission to use their likeness.'] },
      { h: '2. Choose duration and format', p: [`Choose ${lengths} seconds at one credit per second, in portrait 9:16 or landscape 16:9.`] },
      { h: '3. Generate and download', p: ['Sign in, confirm consent and submit. Download the MP4 when ready and label it as AI-generated when sharing.'] },
    ] }
  editObject(`src/content/${locale}.ts`, locale, {
    'meta.homeDescription': about, 'hero.subtitle': about,
    'hero.badge': profile.platform ?? 'TikTok',
    'hero.chips': zh ? ['照片二创', '横竖可选', '下载分享'] : ['Photo remix', 'Portrait or landscape', 'Download and share'],
    'hero.creditNote': credit,
    'whatIs.paragraphs': [intro, about],
    'articles.trend': trend,
    'articles.howTo': guide,
  })
}
setTrendSources(validatedTrendSources)
let wrangler = readFileSync(join(stage, 'wrangler.jsonc'), 'utf8')
const vars = { ...features, SITE_URL: launch === 'local' ? origin : `https://${domain}`, HYPIT_SITE_ID: slug, HYPIT_BRIDGE_URL: bridge.origin,
  ADMIN_EMAILS: adminEmail, GOOGLE_CLIENT_ID: credentials.googleClientId,
  // 本地默认 mock；线上阶段指定真实服务商名称，但还须接通凭据、模型与预算并通过 doctor。
  VIDEO_PROVIDER: launch === 'local' ? 'mock' : 'hypit', PAYMENT_PROVIDER: launch === 'local' ? 'mock' : 'waffo',
  MODERATION_PROVIDER: launch === 'local' ? 'mock' : 'openai', PROMPT_SCAN_PROVIDER: launch === 'local' ? 'mock' : 'waffo', EMAIL_FROM: launch === 'local' ? `noreply@${domain}` : '',
  APP_ENV: launch === 'local' ? 'development' : 'production' }
wrangler = patchWranglerVars(wrangler, vars)
writeFileSync(join(stage, 'wrangler.jsonc'), wrangler)
const pkg = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
pkg.scripts.dev = `vite dev --host 127.0.0.1 --port ${port} --strictPort`
writeFileSync(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
const lock = JSON.parse(readFileSync(join(stage, 'package-lock.json'), 'utf8'))
lock.name = slug
if (lock.packages?.['']) lock.packages[''].name = slug
writeFileSync(join(stage, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
const secrets = { SESSION_SECRET: randomBytes(48).toString('hex'),
  ...(credentials.googleClientSecret ? { GOOGLE_CLIENT_SECRET: credentials.googleClientSecret } : {}),
  ...(credentials.hypitBridgeToken ? { HYPIT_BRIDGE_TOKEN: credentials.hypitBridgeToken } : {}) }
const envText = Object.entries(secrets).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n'
const report = { version: 1, fingerprint, templateCommit: commit, initializedAt: new Date().toISOString(), keyword, domain, launch, features,
  status: launch === 'local' ? 'LOCAL_CONFIGURED_REVIEW_REQUIRED' : 'PRODUCTION_CONFIGURED_REVIEW_REQUIRED', localSeeded: false, pending,
  assets: Object.fromEntries([...files].filter((f) => /\.(mp4|jpg|png|svg)$/.test(f)).map((f) => [f, digest(readFileSync(join(stage, f)))])) }
const bridgeFragment = { [slug]: { mediaOrigins: [origin, `https://${domain}`], templates: { [templateId]: {
  durations, model: 'mini', resolution: '720p', aspectRatio, imagePersonReference: true, videoPersonReference: true,
  ...(workflow ? { workflow: { type: workflow.type, cutFrames: workflow.cutFrames, frameRate: 30 },
    referenceHashes: Object.fromEntries(durations.map((seconds) => [seconds, digest(readFileSync(join(stage, `seed/templates/${templateId}-${seconds}s.mp4`)))])) } : {}),
  prompt: profile.prompt ?? `Create a ${keyword} remix using the reference image for the person and the reference video for timing and movement.`,
} } } }
writeFileSync(join(stage, 'bridge-site.json'), JSON.stringify(bridgeFragment, null, 2) + '\n')
files.add('bridge-site.json')
// 所有生成成功后才落盘；保留原素材与 staging 配置，不递归删除用户文件。
files.delete('scripts/new-site.mjs')
if (run('git', ['status', '--porcelain', '--untracked-files=no']).toString().trim()) throw new Error('准备期间模板被修改，停止写入')
const before = new Map([...files].map((f) => [f, existsSync(join(root, f)) ? readFileSync(join(root, f)) : null]))
let wroteSecrets = false
let wroteState = false
try {
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    copyFileSync(join(stage, file), join(root, file))
  }
  writeFileSync(join(root, '.dev.vars'), envText, { flag: 'wx', mode: 0o600 })
  wroteSecrets = true
  writeFileSync(statePath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  wroteState = true
} catch {
  for (const [file, value] of before) {
    if (value === null) { if (existsSync(join(root, file))) unlinkSync(join(root, file)) }
    else writeFileSync(join(root, file), value)
  }
  if (wroteSecrets) unlinkSync(join(root, '.dev.vars'))
  if (wroteState) unlinkSync(statePath)
  // 不输出包含凭据的底层异常。
  throw new Error('写入未完成，配置文件已回滚；请检查私有 .dev.vars 和初始化状态文件后重试')
}
if (local) {
  // 只调用本机已安装的 wrangler，不通过 npx 下载软件或执行拼接的 shell 命令。
  const cli = join(root, 'node_modules/wrangler/bin/wrangler.js')
  run(process.execPath, [cli, 'd1', 'migrations', 'apply', 'DB', '--local'], root, 'inherit')
  for (const seconds of durations) {
    const file = `${templateId}-${seconds}s.mp4`
    run(process.execPath, [cli, 'r2', 'object', 'put', `${slug}-media/templates/${file}`, '--file', join(root, 'seed/templates', file), '--content-type', 'video/mp4', '--local'], root, 'inherit')
  }
  report.localSeeded = true
  writeFileSync(statePath, JSON.stringify(report, null, 2) + '\n')
}
console.log(`\n初始化已写入。${launch === 'local' ? `运行 npm run dev 打开 ${origin}。` : '已选择线上配置：先接通所选阶段的服务与云资源，再运行 npm run doctor；尚未部署。'}凭据仅写入忽略文件 .dev.vars；待接通项见 .site-initialized.json，Bridge 片段见 bridge-site.json。`)
