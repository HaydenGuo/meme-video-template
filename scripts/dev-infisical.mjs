// 由 infisical run 注入本站目录；不导出密钥文件。
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
if (['.dev.vars', '.dev.vars.local'].some((name) => existsSync(new URL(`../${name}`, import.meta.url)))) {
  console.error('Infisical 模式要求根目录没有 .dev.vars / .dev.vars.local；请先将本地配置迁入本站 Infisical 目录，或继续使用 npm run dev。')
  process.exit(1)
}
const env = { ...process.env }
// 兼容 Auth.js 命名；模板标准变量优先。
env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID?.trim() || env.AUTH_GOOGLE_ID?.trim()
env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET?.trim() || env.AUTH_GOOGLE_SECRET?.trim()
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET?.trim()) {
  console.error('缺少 Google Client ID、Client Secret 或 SESSION_SECRET；请通过 infisical run 注入本站配置。')
  process.exit(1)
}
env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'true'
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'dev', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' })
child.on('error', () => {
  console.error('无法启动本地开发服务。')
  process.exitCode = 1
})
child.on('exit', (code) => { process.exitCode = code ?? 1 })
