// 本地网站与真实 Hypit Bridge 联动。启动本身不提交生成，上传并点击生成才调用模型。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key) => args[args.indexOf(key) + 1]
const managedKeys = new Set(['VIDEO_PROVIDER', 'HYPIT_BRIDGE_URL', 'HYPIT_BRIDGE_TOKEN'])

function parseDotenvValue(value) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('"')) return trimmed
  try { return JSON.parse(trimmed) } catch { return trimmed }
}

function readManagedDotenv(text) {
  const values = {}
  const entries = new Map()
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const match = /^([ \t]*)([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match || !managedKeys.has(match[2])) continue
    if (entries.has(match[2])) throw new Error(`.dev.vars 包含重复配置：${match[2]}`)
    entries.set(match[2], { indent: match[1], line, value: parseDotenvValue(match[3]) })
    values[match[2]] = entries.get(match[2]).value
  }
  return { values, entries }
}

function patchDotenv(path, overrides) {
  if (!existsSync(path)) return { values: {}, restore() {} }
  const original = readFileSync(path, 'utf8')
  const { values, entries } = readManagedDotenv(original)
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.split(/\r?\n/)
  const records = []
  for (const [key, value] of Object.entries(overrides)) {
    const entry = entries.get(key)
    const line = `${entry?.indent ?? ''}${key}=${JSON.stringify(value)}`
    if (entry) {
      const index = lines.indexOf(entry.line)
      if (index < 0) throw new Error(`无法定位 .dev.vars 的 ${key}`)
      lines[index] = line
    } else {
      const trailingEmpty = lines.at(-1) === ''
      if (trailingEmpty) lines.splice(lines.length - 1, 0, line)
      else lines.push(line)
    }
    records.push({ key, line, originalLine: entry?.line ?? null })
  }
  const patched = lines.join(newline)
  if (patched !== original) {
    if (readFileSync(path, 'utf8') !== original) throw new Error('.dev.vars 在覆盖前发生了修改，请重试')
    writeFileSync(path, patched, { mode: 0o600 })
  }
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    let current
    try { current = readFileSync(path, 'utf8') } catch { return }
    const currentNewline = current.includes('\r\n') ? '\r\n' : '\n'
    const currentLines = current.split(/\r?\n/)
    let changed = false
    for (const record of records) {
      const indices = currentLines.flatMap((line, index) => line === record.line ? [index] : [])
      if (indices.length !== 1) {
        if (indices.length > 0) console.error(`检测到 .dev.vars 的 ${record.key} 有并发修改，保留当前值。`)
        continue
      }
      const index = indices[0]
      if (record.originalLine === null) currentLines.splice(index, 1)
      else currentLines[index] = record.originalLine
      changed = true
    }
    if (changed) writeFileSync(path, currentLines.join(currentNewline), { mode: 0o600 })
  }
  return { values, restore }
}

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error(`${label} 无效或不可读`) }
}

function validateLocalOrigin(siteConfig) {
  if (!siteConfig || typeof siteConfig !== 'object' || Array.isArray(siteConfig)) throw new Error('bridge-site.json 必须是站点对象')
  for (const site of Object.values(siteConfig)) {
    if (!site || !Array.isArray(site.mediaOrigins)) continue
    for (const value of site.mediaOrigins) {
      let url
      try { url = new URL(value) } catch { continue }
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) continue
      if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) continue
      if (!url.port || !Number.isInteger(Number(url.port))) continue
      return url
    }
  }
  throw new Error('bridge-site.json 没有可用的本地媒体 origin')
}

if (args.includes('--help')) {
  console.log('node scripts/dev-hypit.mjs --project <Hypit目录> --runtime <runtime.json> [--port 8789]')
  process.exit(0)
}

async function main() {
  for (const key of ['--project', '--runtime']) if (!args.includes(key) || !option(key) || option(key).startsWith('--')) throw new Error(`需要 ${key}`)
  const project = resolve(option('--project'))
  const runtime = resolve(option('--runtime'))
  const cliPath = resolve(project, 'node_modules/@hypit/hypit/bin/hypit.mjs')
  const vitePath = resolve(root, 'node_modules/vite/bin/vite.js')
  if (!existsSync(cliPath) || !existsSync(runtime)) throw new Error('Hypit CLI 或 Runtime 不存在')
  if (!existsSync(vitePath)) throw new Error('Vite 不存在，请先安装本站依赖')
  const port = args.includes('--port') ? Number(option('--port')) : 8789
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Bridge 端口无效')
  const publicUrl = `http://127.0.0.1:${port}`
  const state = readJson(resolve(root, '.site-initialized.json'), '.site-initialized.json')
  if (!state || typeof state.keyword !== 'string' || state.keyword.length === 0) throw new Error('.site-initialized.json 缺少 keyword')
  const sites = readJson(resolve(root, 'bridge-site.json'), 'bridge-site.json')
  const origin = validateLocalOrigin(sites)
  const envPath = resolve(root, '.dev.vars')
  const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const { values: envValues } = readManagedDotenv(envText)
  const token = String(envValues.HYPIT_BRIDGE_TOKEN || process.env.HYPIT_BRIDGE_TOKEN || randomBytes(32).toString('hex'))
  if (token.length < 32) throw new Error('Hypit Bridge token 至少需要 32 个字符')
  const localDir = resolve(root, '.tmp/hypit-local')
  const configPath = resolve(localDir, 'bridge.config.json')
  const outputSecretPath = resolve(localDir, 'output-secret')
  const outputSecret = existsSync(outputSecretPath) ? readFileSync(outputSecretPath, 'utf8') : randomBytes(32).toString('hex')
  if (outputSecret.length < 32) throw new Error('Bridge output secret 至少需要 32 个字符')
  mkdirSync(localDir, { recursive: true })
  if (!existsSync(outputSecretPath)) writeFileSync(outputSecretPath, outputSecret, { mode: 0o600, flag: 'wx' })
  writeFileSync(configPath, JSON.stringify({ host: '127.0.0.1', port, publicUrl, mode: 'hypit',
    dataDir: resolve(project, '.hypit/bridge', `local-${root.split(/[\\/]/).at(-1)}`),
    projectRoot: project, runtimeProfile: runtime, maxActive: 1, maxQueued: 20, maxAgeMs: 2100000,
    retentionMs: 86400000, maxStorageBytes: 2147483648, sites }, null, 2))

  // Wrangler 会优先读取 .dev.vars；只临时覆盖两个模式键和必要的新 token，结束时逐键恢复。
  const overrides = { VIDEO_PROVIDER: 'hypit', HYPIT_BRIDGE_URL: publicUrl, HYPIT_BRIDGE_TOKEN: token }
  const devVars = patchDotenv(envPath, overrides)
  const siteEnv = { ...process.env, ...overrides, CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true' }
  const children = []
  let stopping = false
  const stop = (code = 0) => {
    if (stopping) return
    stopping = true
    devVars.restore()
    for (const child of children) if (!child.killed) child.kill()
    process.exitCode = code
  }
  process.once('exit', () => devVars.restore())
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop())
  const launch = (file, argv, env) => {
    const child = spawn(process.execPath, [file, ...argv], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    children.push(child)
    child.on('error', () => stop(1))
    child.on('exit', (code) => stop(code ?? 1))
    return child
  }

  try {
    launch(resolve(root, 'services/hypit-bridge/src/server.mjs'), [], {
      ...process.env, BRIDGE_CONFIG: configPath, BRIDGE_TOKEN: token, BRIDGE_OUTPUT_SECRET: outputSecret,
    })
    // 先确认本次启动的 Bridge 可用，端口占用或配置错误时不启动网页。
    let ready = false
    for (let i = 0; i < 50 && !stopping; i++) {
      await new Promise((ok) => setTimeout(ok, 200))
      try {
        const response = await fetch(`${publicUrl}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) })
        ready = response.ok && (await response.json()).mode === 'hypit'
        if (ready) break
      } catch {}
    }
    if (!ready || stopping) return stop(1)
    console.log(`本地真实生成模式：${state.keyword}。启动不生成；提交任务会消耗模型额度。`)
    launch(vitePath, ['dev', '--host', '127.0.0.1', '--port', origin.port, '--strictPort'], siteEnv)
  } catch (error) {
    stop(1)
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
