#!/usr/bin/env node
// 默认仅预览，--apply 仅修改本地配置；不修改密钥、不部署、不改变云端开关。
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWranglerConfig } from './doctor.mjs'
import { LAUNCH_MODES, launchVars, patchWranglerVars } from './launch-config.mjs'
import { resolveFeatures } from '../src/server/config-health.ts'

const args = process.argv.slice(2)
const usage = `npm run site:mode -- <${Object.keys(LAUNCH_MODES).join('|')}> [--apply]`
if (args.includes('--help')) { console.log(usage); process.exit(0) }
if (!args[0] || args.slice(1).some((arg) => arg !== '--apply') || args.filter((arg) => arg === '--apply').length > 1) throw new Error(usage)
const mode = args[0]
const patch = launchVars(mode)
const path = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
const source = readFileSync(path, 'utf8')
const config = readWranglerConfig(path)
if (mode === 'local' && config.vars?.APP_ENV !== 'development') throw new Error('local 仅用于 APP_ENV=development，不改变线上环境')
const next = patchWranglerVars(source, patch)
console.log(JSON.stringify({ file: resolve(path), mode, appEnv: config.vars?.APP_ENV, before: resolveFeatures(config.vars ?? {}), after: resolveFeatures({ ...config.vars, ...patch }) }, null, 2))
console.log('仅改变新业务入口。关闭新购买仍需保留已有订单的支付凭据、回调与订阅管理；关闭新生成不暂停已排队任务。展示模式会暂停所有 API 业务、队列和定时任务，不应用于已有活跃业务的站点。')
if (!args.includes('--apply')) { console.log('仅预览。加 --apply 写入本地配置；之后运行 npm run doctor。'); process.exit(0) }
// 同卷临时文件写完再替换，避免写入失败时截断配置。替换前再次核对共享工作区。
const tempDir = join(dirname(path), '.tmp', 'site-mode')
mkdirSync(tempDir, { recursive: true })
const temp = join(tempDir, `${randomUUID()}.jsonc`)
try {
  writeFileSync(temp, next, { flag: 'wx' })
  if (readFileSync(path, 'utf8') !== source) throw new Error('配置在读取后已变化，停止写入')
  renameSync(temp, path)
} finally {
  if (existsSync(temp)) unlinkSync(temp)
}
console.log('本地配置已更新，尚未部署。运行 npm run doctor，通过后再按发布流程上线。')
