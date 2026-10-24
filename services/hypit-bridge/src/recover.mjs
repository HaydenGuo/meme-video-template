import { existsSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { createHypitRunner } from './hypit.mjs'

const args = process.argv.slice(2)
const valueAfter = (key) => {
  const index = args.indexOf(key)
  const value = index < 0 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`需要 ${key} 的值`)
  return value
}

function usage() {
  console.log(`用法：
  node services/hypit-bridge/src/recover.mjs --config <bridge.config.json> --job <job hash> --build <Hypit Build ID>
  node services/hypit-bridge/src/recover.mjs --config <bridge.config.json> --job <job hash> --confirm-no-submission`)
}

if (args.includes('--help')) {
  usage()
  process.exit(0)
}

function readConfig(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('Bridge 配置无效或不可读') }
}

function validateBuildId(value) {
  if (!/^bld_\d{8}T\d{9}Z_[0-9A-Z]{10}$/.test(value)) throw new Error('Hypit Build ID 格式无效')
}

async function main() {
  const configPath = resolve(args.includes('--config') ? valueAfter('--config') : 'bridge.config.json')
  const jobId = valueAfter('--job')
  const buildId = args.includes('--build') ? valueAfter('--build') : undefined
  const confirmNoSubmission = args.includes('--confirm-no-submission')
  const knownOptions = new Set(['--config', '--job', '--build', '--confirm-no-submission', '--help'])
  for (const arg of args) if (arg.startsWith('--') && !knownOptions.has(arg)) throw new Error(`未知参数：${arg}`)
  if (!/^[a-f0-9]{64}$/.test(jobId)) throw new Error('Bridge job ID 必须是 64 位小写十六进制哈希')
  if ((buildId === undefined) === !confirmNoSubmission) throw new Error('必须选择 --build 或 --confirm-no-submission 其中一个')
  if (buildId !== undefined) validateBuildId(buildId)

  const config = readConfig(configPath)
  if (config.mode !== 'hypit') throw new Error('恢复命令只允许处理 mode=hypit 的 Bridge')
  for (const key of ['dataDir', 'projectRoot', 'runtimeProfile']) {
    if (typeof config[key] !== 'string' || config[key].length === 0) throw new Error(`Bridge 配置缺少 ${key}`)
  }
  const root = resolve(config.dataDir)
  const jobsPath = resolve(root, 'jobs.sqlite')
  const leasePath = resolve(root, 'instance.sqlite')
  if (!existsSync(jobsPath)) throw new Error('找不到 Bridge jobs.sqlite')

  // Bridge 的 instance.sqlite 使用同一个独占锁；在线服务会在这里被拒绝。
  const lease = new DatabaseSync(leasePath)
  try {
    lease.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS singleton (id INTEGER); BEGIN EXCLUSIVE')
  } catch {
    lease.close()
    throw new Error('Bridge 仍在运行，请先停止服务再恢复')
  }

  let db
  try { db = new DatabaseSync(jobsPath) } catch (error) {
    lease.close()
    throw error
  }
  try {
    const row = db.prepare('SELECT id,state,build_id,error FROM jobs WHERE id=?').get(jobId)
    if (!row) throw new Error('Bridge job 不存在')
    if (row.state !== 'attention' || row.build_id) throw new Error('只允许恢复没有 Build receipt 的 attention job')

    if (confirmNoSubmission) {
      const result = db.prepare("UPDATE jobs SET state='failed',error='submission_not_confirmed',updated=? WHERE id=? AND state='attention' AND build_id IS NULL").run(Date.now(), jobId)
      if (result.changes !== 1) throw new Error('job 状态已变化，未执行释放')
      console.log(`已将 ${jobId} 标记为 failed；需由站点原有流程退款。`)
      return
    }

    if (!existsSync(resolve(config.projectRoot, 'node_modules/@hypit/hypit/bin/hypit.mjs'))) throw new Error('Hypit CLI 不存在')
    if (!existsSync(resolve(config.runtimeProfile))) throw new Error('Hypit Runtime 不存在')
    const runner = createHypitRunner(config)
    const inspected = await runner.inspect(buildId)
    const build = inspected?.format === 'hypit.cli-status@1' ? inspected.build : undefined
    const expectedTitle = `bridge:${jobId}`
    if (!build || build.id !== buildId) throw new Error('Hypit 未返回指定 Build，未写入 receipt')
    if (build.title !== expectedTitle) throw new Error('Hypit Build title 与 Bridge job 不匹配，未写入 receipt')
    const result = db.prepare("UPDATE jobs SET state='running',build_id=?,error=NULL,updated=? WHERE id=? AND state='attention' AND build_id IS NULL").run(buildId, Date.now(), jobId)
    if (result.changes !== 1) throw new Error('job 状态已变化，未写入 receipt')
    console.log(`已核验 ${buildId} 的 title，并恢复 ${jobId} 为 running。`)
  } finally {
    db.close()
    lease.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
