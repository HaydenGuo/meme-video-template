// 本地网站与真实 Hypit Bridge 联动。启动本身不提交生成，上传并点击生成才调用模型。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key) => args[args.indexOf(key) + 1]
if (args.includes('--help')) {
  console.log('node scripts/dev-hypit.mjs --project <Hypit目录> --runtime <runtime.json> [--port 8789]')
  process.exit(0)
}
for (const key of ['--project', '--runtime']) if (!args.includes(key) || !option(key) || option(key).startsWith('--')) throw new Error(`需要 ${key}`)
const project = resolve(option('--project'))
const runtime = resolve(option('--runtime'))
if (!existsSync(resolve(project, 'node_modules/@hypit/hypit/bin/hypit.mjs')) || !existsSync(runtime)) throw new Error('Hypit CLI 或 Runtime 不存在')
const port = args.includes('--port') ? Number(option('--port')) : 8789
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Bridge 端口无效')
const envPath = resolve(root, '.dev.vars')
let envText = readFileSync(envPath, 'utf8')
const envValues = Object.fromEntries(envText.split(/\r?\n/).filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line)).map((line) => {
  const split = line.indexOf('='); const value = line.slice(split + 1)
  return [line.slice(0, split), value.startsWith('"') ? JSON.parse(value) : value]
}))
const token = envValues.HYPIT_BRIDGE_TOKEN || randomBytes(32).toString('hex')
if (!envValues.HYPIT_BRIDGE_TOKEN) {
  envText += `\nHYPIT_BRIDGE_TOKEN=${JSON.stringify(token)}\n`
  writeFileSync(envPath, envText, { mode: 0o600 })
}
const localDir = resolve(root, '.tmp/hypit-local')
mkdirSync(localDir, { recursive: true })
const publicUrl = `http://127.0.0.1:${port}`
const configPath = resolve(localDir, 'bridge.config.json')
const outputSecretPath = resolve(localDir, 'output-secret')
const outputSecret = existsSync(outputSecretPath) ? readFileSync(outputSecretPath, 'utf8') : randomBytes(32).toString('hex')
if (!existsSync(outputSecretPath)) writeFileSync(outputSecretPath, outputSecret, { mode: 0o600, flag: 'wx' })
writeFileSync(configPath, JSON.stringify({ host: '127.0.0.1', port, publicUrl, mode: 'hypit',
  dataDir: resolve(project, '.hypit/bridge', `local-${root.split(/[\\/]/).at(-1)}`),
  projectRoot: project, runtimeProfile: runtime, maxActive: 1, maxQueued: 20, maxAgeMs: 2100000,
  retentionMs: 86400000, maxStorageBytes: 2147483648,
  sites: JSON.parse(readFileSync(resolve(root, 'bridge-site.json'), 'utf8')) }, null, 2))
// 使用私有本地覆盖文件，生产配置仍由部署流程管理。不要在已有任务执行时改变服务模式。
const overrides = { VIDEO_PROVIDER: 'hypit', HYPIT_BRIDGE_URL: publicUrl }
for (const [key, value] of Object.entries(overrides)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  envText = pattern.test(envText) ? envText.replace(pattern, `${key}=${JSON.stringify(value)}`) : `${envText}\n${key}=${JSON.stringify(value)}\n`
}
writeFileSync(envPath, envText, { mode: 0o600 })
const children = []
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill(); process.exitCode = code }
const launch = (file, argv, env = process.env) => {
  const child = spawn(process.execPath, [file, ...argv], { cwd: root, env, stdio: 'inherit', windowsHide: true })
  children.push(child)
  child.on('error', () => stop(1))
  child.on('exit', (code) => stop(code ?? 0))
  return child
}
launch(resolve(root, 'services/hypit-bridge/src/server.mjs'), [], { ...process.env, BRIDGE_CONFIG: configPath, BRIDGE_TOKEN: token, BRIDGE_OUTPUT_SECRET: outputSecret })
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
if (!ready || stopping) stop(1)
else {
  const state = JSON.parse(readFileSync(resolve(root, '.site-initialized.json'), 'utf8'))
  const sites = JSON.parse(readFileSync(resolve(root, 'bridge-site.json'), 'utf8'))
  const origin = sites[Object.keys(sites)[0]].mediaOrigins.find((url) => url.startsWith('http://127.0.0.1:'))
  console.log(`本地真实生成模式：${state.keyword}。启动不生成；提交任务会消耗模型额度。`)
  launch(resolve(root, 'node_modules/vite/bin/vite.js'), ['dev', '--host', '127.0.0.1', '--port', new URL(origin).port, '--strictPort'])
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop())
