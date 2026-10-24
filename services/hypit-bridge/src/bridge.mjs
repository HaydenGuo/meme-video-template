import { DatabaseSync } from 'node:sqlite'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, stat, rm, writeFile, readdir, statfs } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { createHypitRunner } from './hypit.mjs'

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const hash = (value) => createHash('sha256').update(value).digest('hex')
const fault = (status, code) => Object.assign(new Error(code), { status, code })

export async function createBridge(config, { token, outputSecret, runner } = {}) {
  if (!token || token.length < 32 || !outputSecret || outputSecret.length < 32) throw new Error('Bridge secrets must contain at least 32 characters')
  if (!['mock', 'passthrough', 'hypit'].includes(config.mode)) throw new Error('Invalid Bridge mode')
  const publicUrl = new URL(config.publicUrl)
  if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) throw new Error('publicUrl must be an origin')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)
  if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && local)) throw new Error('HTTPS required')
  if (config.mode !== 'hypit' && (!local || config.host !== '127.0.0.1')) throw new Error('Mock and passthrough require loopback binding')
  for (const key of ['maxActive', 'maxQueued', 'maxAgeMs', 'retentionMs', 'maxStorageBytes']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`Invalid ${key}`)
  }
  const root = resolve(config.dataDir)
  if (config.mode !== 'mock') {
    const location = relative(resolve(config.projectRoot), root)
    if (location.startsWith('..') || isAbsolute(location) || location === '') throw new Error('Hypit dataDir must be inside projectRoot')
  }
  await mkdir(root, { recursive: true })
  const db = new DatabaseSync(resolve(root, 'jobs.sqlite'))
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, input TEXT NOT NULL, template TEXT NOT NULL,
    state TEXT NOT NULL, build_id TEXT, output_name TEXT, created INTEGER NOT NULL,
    updated INTEGER NOT NULL, error TEXT, mode TEXT NOT NULL
  )`)
  if (db.prepare("SELECT id FROM jobs WHERE state NOT IN ('completed','failed','expired') AND mode != ? LIMIT 1").get(config.mode)) {
    db.close()
    throw new Error('Active jobs require their original Bridge mode')
  }
  // 占有 SQLite 写锁，拒绝第二个服务进程；崩溃后 SQLite 自动释放锁。
  const lease = new DatabaseSync(resolve(root, 'instance.sqlite'))
  lease.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS singleton (id INTEGER); BEGIN EXCLUSIVE')
  const hypit = runner ?? (config.mode === 'mock' ? null : createHypitRunner(config))
  const rows = (sql, ...params) => db.prepare(sql).all(...params)
  const job = (id) => db.prepare('SELECT * FROM jobs WHERE id=?').get(id)
  const update = (id, state, error = null) => db.prepare('UPDATE jobs SET state=?,error=?,updated=? WHERE id=?').run(state, error, Date.now(), id)
  // 没有 receipt 的提交一旦中断，保留占位；禁止重提或自动释放并发。
  db.prepare("UPDATE jobs SET state='attention',error='submission_unknown' WHERE state='submitting' AND build_id IS NULL").run()
  const sign = (id, expires) => createHmac('sha256', outputSecret).update(`${id}:${expires}`).digest('hex')
  const directory = (id) => resolve(root, id)
  let pumping = false
  let stopped = false

  function validate(body) {
    if (!body || Array.isArray(body) || typeof body !== 'object') throw fault(400, 'invalid_request')
    for (const key of ['generationId', 'siteId', 'templateId']) if (typeof body[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body[key])) throw fault(400, 'invalid_request')
    const site = config.sites[body.siteId]
    const template = site?.templates[body.templateId]
    if (!template || !template.durations.includes(body.durationSeconds)) throw fault(400, 'template_not_allowed')
    if (body.aspectRatio !== undefined && !['9:16', '16:9'].includes(body.aspectRatio)) throw fault(400, 'invalid_aspect_ratio')
    for (const key of ['imageUrl', 'sourceVideoUrl']) {
      let url
      try { url = new URL(body[key]) } catch { throw fault(400, 'invalid_media') }
      if (url.href.length > 8192 || url.username || url.password || url.hash || !site.mediaOrigins.includes(url.origin)) throw fault(400, 'media_not_allowed')
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if (url.protocol !== 'https:' && !(local && loopback && url.protocol === 'http:')) throw fault(400, 'media_not_allowed')
    }
    return { input: Object.fromEntries(['generationId', 'siteId', 'templateId', 'durationSeconds', 'aspectRatio', 'imageUrl', 'sourceVideoUrl'].map((key) => [key, body[key]])), template }
  }

  async function download(url, path, maxBytes, mediaType) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith(mediaType)) throw new Error('Media download failed')
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); throw new Error('Media too large') }
    // 每个任务最多一张图片和一个模板视频，并发、输入体积和总磁盘都有上限。
    const chunks = []
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.length
      if (bytes > maxBytes) throw new Error('Media too large')
      chunks.push(chunk)
    }
    await writeFile(path, Buffer.concat(chunks))
    return response.headers.get('content-type').split(';')[0].trim()
  }

  async function spaceAvailable() {
    let size = 0
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue
      for (const file of await readdir(resolve(root, entry.name))) size += (await stat(resolve(root, entry.name, file))).size
    }
    const fs = await statfs(root)
    return size + 256 * 1024 * 1024 <= config.maxStorageBytes && fs.bavail * fs.bsize > 512 * 1024 * 1024
  }

  async function advance(row) {
    const dir = directory(row.id)
    const input = JSON.parse(row.input)
    if (row.state === 'queued' || row.state === 'preparing') {
      if (Date.now() - row.created > config.maxAgeMs) return update(row.id, 'failed', 'queue_expired')
      if (!(await spaceAvailable())) return update(row.id, 'failed', 'storage_full')
      update(row.id, 'preparing')
      await mkdir(dir, { recursive: true })
      await download(input.sourceVideoUrl, resolve(dir, 'source.mp4'), 100 * 1024 * 1024, 'video/')
      if (config.mode === 'mock') {
        await writeFile(resolve(dir, 'output.mp4'), await (await import('node:fs/promises')).readFile(resolve(dir, 'source.mp4')))
        return update(row.id, 'completed')
      }
      const imageMediaType = await download(input.imageUrl, resolve(dir, 'image.png'), 10 * 1024 * 1024, 'image/')
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(imageMediaType)) return update(row.id, 'failed', 'unsupported_image')
      const prepared = await hypit.prepare({ ...input, imageMediaType }, JSON.parse(row.template), dir)
      const checked = await hypit.check(prepared.run)
      if (!checked.ok) return update(row.id, 'failed', 'hypit_check_failed')
      // 必须在任何外部提交之前持久写入 submitting。
      db.prepare("UPDATE jobs SET state='submitting',output_name=?,updated=? WHERE id=?").run(prepared.output, Date.now(), row.id)
      const buildId = await hypit.submit(prepared.run, row.id)
      db.prepare("UPDATE jobs SET state='running',build_id=?,updated=? WHERE id=?").run(buildId, Date.now(), row.id)
      return
    }
    if (row.state !== 'running') return
    const state = await hypit.status(row.build_id)
    if (state === 'complete') {
      await hypit.export(row.build_id, row.output_name, resolve(dir, 'output.mp4'))
      const output = await stat(resolve(dir, 'output.mp4'))
      if (!output.size || output.size > 100 * 1024 * 1024) return update(row.id, 'failed', 'output_size')
      try { await hypit.verify?.(resolve(dir, 'output.mp4'), input, JSON.parse(row.template)) }
      catch { return update(row.id, 'failed', 'output_invalid') }
      return update(row.id, 'completed')
    }
    if (state === 'failed' || state === 'cancelled') return update(row.id, 'failed', 'hypit_failed')
    if (Date.now() - row.created > config.maxAgeMs) {
      // 取消后继续占用并发，直到 Hypit 证实终态。
      await hypit.cancel(row.build_id)
    }
  }

  async function tick() {
    if (pumping || stopped) return
    pumping = true
    try {
      for (const row of rows("SELECT * FROM jobs WHERE state IN ('running','preparing')")) {
        try { await advance(row) } catch { if (job(row.id).state === 'submitting') update(row.id, 'attention', 'submission_unknown'); else if (row.state === 'preparing') update(row.id, 'failed', 'preparation_failed') }
      }
      while (!stopped && rows("SELECT id FROM jobs WHERE state IN ('running','preparing','submitting','attention')").length < config.maxActive) {
        const row = rows("SELECT * FROM jobs WHERE state='queued' ORDER BY created LIMIT 1")[0]
        if (!row) break
        try { await advance(row) } catch { update(row.id, job(row.id).state === 'submitting' ? 'attention' : 'failed', job(row.id).state === 'submitting' ? 'submission_unknown' : 'preparation_failed') }
      }
      for (const row of rows("SELECT * FROM jobs WHERE state IN ('completed','failed') AND updated < ?", Date.now() - config.retentionMs)) {
        await rm(directory(row.id), { recursive: true, force: true })
        update(row.id, 'expired', 'result_expired')
      }
    } finally { pumping = false }
  }

  const server = createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
    try {
      const url = new URL(req.url, publicUrl)
      const match = /^\/v1\/jobs\/([a-f0-9]{64})(\/output)?$/.exec(url.pathname)
      if (match?.[2] && req.method === 'GET') {
        const expires = url.searchParams.get('expires') ?? ''
        if (!/^\d{13}$/.test(expires) || Number(expires) < Date.now() || Number(expires) > Date.now() + 16 * 60_000 || !same(url.searchParams.get('sig'), sign(match[1], expires))) throw fault(403, 'invalid_signature')
        const row = job(match[1])
        if (row?.state !== 'completed') throw fault(404, 'output_not_found')
        const path = resolve(directory(row.id), 'output.mp4')
        const file = await stat(path)
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': file.size, 'Cache-Control': 'private, no-store' })
        createReadStream(path).on('error', () => res.destroy()).pipe(res)
        return
      }
      if (!same(req.headers.authorization, `Bearer ${token}`)) throw fault(401, 'unauthorized')
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, mode: config.mode, jobs: rows('SELECT state,COUNT(*) AS count FROM jobs GROUP BY state') })
      if (req.method === 'POST' && url.pathname === '/v1/jobs') {
        const chunks = []
        let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 24_576) throw fault(413, 'body_too_large'); chunks.push(chunk) }
        let body
        try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { throw fault(400, 'invalid_json') }
        const { input, template } = validate(body)
        const id = hash(`${input.siteId}:${input.generationId}`)
        const fingerprint = hash(JSON.stringify(input))
        const existing = job(id)
        if (existing && existing.fingerprint !== fingerprint) throw fault(409, 'idempotency_conflict')
        if (!existing) {
          if (rows("SELECT id FROM jobs WHERE state='queued'").length >= config.maxQueued) throw fault(429, 'queue_full')
          db.prepare("INSERT INTO jobs(id,fingerprint,input,template,state,created,updated,mode) VALUES (?,?,?,?,'queued',?,?,?)").run(id, fingerprint, JSON.stringify(input), JSON.stringify(template), Date.now(), Date.now(), config.mode)
        }
        return json(202, { id, mode: existing?.mode ?? config.mode })
      }
      if (match && !match[2] && req.method === 'GET') {
        const row = job(match[1])
        if (!row) throw fault(404, 'job_not_found')
        const state = row.state === 'completed' ? 'completed' : ['failed', 'expired'].includes(row.state) ? 'failed' : 'pending'
        const expires = String(Date.now() + 15 * 60_000)
        return json(200, { id: row.id, state, mode: row.mode, ...(state === 'completed' ? { outputUrl: `${publicUrl.origin}/v1/jobs/${row.id}/output?expires=${expires}&sig=${sign(row.id, expires)}` } : {}) })
      }
      throw fault(404, 'not_found')
    } catch (error) { if (!res.headersSent) json(error.status ?? 500, { error: error.code ?? 'internal_error' }); else res.destroy() }
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.maxRequestsPerSocket = 100
  let timer
  return {
    server, tick,
    async start() {
      await new Promise((ok, fail) => { server.once('error', fail); server.listen(config.port, config.host, ok) })
      timer = setInterval(() => { tick().catch(() => {}) }, config.pollMs ?? 2000)
      return server.address()
    },
    async close() {
      stopped = true
      clearInterval(timer)
      await new Promise((ok) => server.close(ok))
      while (pumping) await new Promise((ok) => setTimeout(ok, 20))
      lease.close(); db.close()
    },
  }
}
