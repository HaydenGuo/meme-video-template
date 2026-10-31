import { createWriteStream, openAsBlob } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { extractReferenceAudio, prepareModelMedia } from './media-preflight.mjs'
import { composeVideoPrompt, scanLocalPrompt } from './prompt-safety.mjs'

const exec = promisify(execFile)
const DEFAULT_HOSTS = [
  'noimg.oss-cn-shenzhen.aliyuncs.com',
  'ark-acg-cn-beijing.volces.com',
  'ark-acg-cn-beijing.tos-cn-beijing.volces.com',
  'xxcapi.com',
]
const firstString = (...items) => items.find((item) => typeof item === 'string' && item.length > 0)
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

function taskId(task) {
  const data = object(task.data)
  return firstString(data.id, data.task_id, data.cgt_task_id, task.id, task.task_id, task.cgt_task_id)
}

function taskState(task) {
  const data = object(task.data)
  const nested = object(data.data)
  const states = [task.status, data.status, nested.status].filter((value) => typeof value === 'string').map((value) => value.toLowerCase())
  if (states.some((value) => ['failed', 'error', 'cancelled', 'canceled'].includes(value))) return 'failed'
  if (states.some((value) => ['success', 'succeeded', 'completed'].includes(value))) return 'complete'
  if (states.some((value) => ['queued', 'running', 'processing', 'pending'].includes(value))) return 'running'
  return 'unknown'
}

function resultUrl(task) {
  const data = object(task.data)
  const nested = object(data.data)
  const content = object(data.content)
  const directContent = object(task.content)
  const result = object(task.result)
  return firstString(content.video_url, content.url, directContent.video_url, directContent.url,
    result.video_url, result.url, data.video_url, task.video_url, task.result_url,
    data.result_url, object(nested[0]).url, object(data[0]).url)
}

function isTrustedUrl(value, hosts) {
  let parsed
  try { parsed = new URL(value) } catch { throw new Error('NoToken returned an invalid media URL') }
  const trusted = [...hosts].some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
  if (parsed.protocol !== 'https:' || !trusted || parsed.username || parsed.password || parsed.port) throw new Error('NoToken returned an untrusted media URL')
  return parsed.href
}

export function createNoTokenRunner(config, { fetcher = globalThis.fetch, run = exec } = {}) {
  const apiKey = process.env.NOTOKEN_API_KEY
  if (typeof apiKey !== 'string' || apiKey.trim().length < 16) throw new Error('NOTOKEN_API_KEY is not configured')
  let base
  try {
    base = new URL(config.noTokenBaseUrl ?? process.env.NOTOKEN_BASE_URL ?? 'https://notoken.pro')
    if (base.protocol !== 'https:' || base.username || base.password || base.port || base.search || base.hash || base.pathname !== '/') throw new Error()
  } catch {
    throw new Error('Invalid NoToken API base URL')
  }
  const hosts = new Set([...DEFAULT_HOSTS, base.hostname, ...(config.noTokenMediaHosts ?? []).map((value) => String(value).toLowerCase())])
  const timeoutMs = Number.isSafeInteger(config.noTokenTimeoutMs) ? config.noTokenTimeoutMs : 120_000
  const ffmpegConcurrency = Number.isSafeInteger(config.ffmpegConcurrency) && config.ffmpegConcurrency > 0 ? config.ffmpegConcurrency : 2
  let ffmpegActive = 0
  const ffmpegWaiters = []
  async function runMedia(command, args, options) {
    if (ffmpegActive >= ffmpegConcurrency) await new Promise((resolve) => ffmpegWaiters.push(resolve))
    ffmpegActive += 1
    try { return await run(command, args, options) }
    finally {
      ffmpegActive -= 1
      ffmpegWaiters.shift()?.()
    }
  }
  const probe = async (path) => {
    const { stdout } = await runMedia(config.ffprobePath ?? 'ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], {
      timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true,
    })
    return JSON.parse(stdout)
  }
  async function request(path, init = {}) {
    let response
    try {
      response = await fetcher(new URL(path, base), {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new Error('NoToken API request failed')
    }
    if (!response.ok) {
      const error = new Error(`NoToken API returned HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return response
  }
  async function json(path, init) {
    let value
    try { value = await (await request(path, init)).json() } catch (error) {
      if (error?.status) throw error
      throw new Error('NoToken returned invalid JSON')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NoToken returned an invalid response')
    return value
  }
  async function upload(path, mediaType, filename) {
    const form = new FormData()
    form.set('file', await openAsBlob(path, { type: mediaType }), filename)
    const uploaded = await json('/api/v3/files/uploads', { method: 'POST', body: form })
    const id = firstString(uploaded.file_id, uploaded.id, object(uploaded.data).file_id, object(uploaded.data).id)
    if (!id || id.length > 200) throw new Error('NoToken upload returned no file id')
    const file = await json(`/api/v3/files/${encodeURIComponent(id)}`)
    const url = isTrustedUrl(firstString(file.url, object(file.data).url), hosts)
    return url
  }
  async function readTask(id) {
    return json(`/api/v3/contents/generations/tasks/${encodeURIComponent(id)}`)
  }
  async function download(url, path, maximum) {
    const trusted = isTrustedUrl(url, hosts)
    const response = await fetcher(trusted, { redirect: 'error', signal: AbortSignal.timeout(600_000) })
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('video/')) throw new Error('NoToken video download failed')
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maximum) { await response.body.cancel(); throw new Error('NoToken video result too large') }
    let total = 0
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        total += chunk.length
        callback(total > maximum ? new Error('NoToken video result too large') : null, chunk)
      },
    })
    await pipeline(response.body, limiter, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
    if (!total) throw new Error('NoToken video result is empty')
  }

  return {
    async prepare(job, template, dir) {
      await mkdir(dir, { recursive: true })
      if (template.workflow?.type !== 'reference-remix-v1' || template.workflow.frameRate !== 30) throw new Error('Direct NoToken mode requires reference-remix-v1 with source audio')
      const original = resolve(dir, 'source.mp4')
      const image = resolve(dir, 'image.png')
      const sourceInfo = await probe(original)
      const sourceSeconds = Number(sourceInfo.format?.duration)
      if (!Number.isFinite(sourceSeconds) || Math.abs(sourceSeconds - job.durationSeconds) > 0.1 ||
          !sourceInfo.streams?.some((stream) => stream.codec_type === 'video') ||
          !sourceInfo.streams?.some((stream) => stream.codec_type === 'audio')) throw new Error('Reference video or soundtrack invalid')
      const expectedValue = template.referenceHashes?.[job.durationSeconds]
      const expected = Array.isArray(expectedValue) ? expectedValue : [expectedValue]
      const actual = createHash('sha256').update(await readFile(original)).digest('hex')
      if (!expected.length || expected.length > 4 || expected.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) || !expected.includes(actual)) throw new Error('Reference differs from approved template')
      const imageInfo = await probe(image)
      if (!imageInfo.streams?.some((stream) => stream.codec_type === 'video' && stream.width > 0 && stream.height > 0)) throw new Error('Invalid portrait')
      const prompt = composeVideoPrompt(template.prompt, job.backgroundDescription?.trim())
      const verdict = await scanLocalPrompt(prompt, job.backgroundDescription?.trim() ?? '')
      await writeFile(resolve(dir, 'prompt-review.json'), JSON.stringify(verdict), { mode: 0o600 })
      if (verdict.action !== 'allow') throw new Error(verdict.action === 'review' ? 'prompt_review_required' : 'prompt_blocked')
      const soundtrack = await extractReferenceAudio({ dir, probe, config, durationSeconds: job.durationSeconds, run: runMedia })
      const prepared = {
        image: await prepareModelMedia({ dir, kind: 'image', probe, config, run: runMedia }),
        video: await prepareModelMedia({ dir, kind: 'video', probe, config, durationSeconds: job.durationSeconds, run: runMedia }),
      }
      await writeFile(resolve(dir, 'media-preflight.json'), JSON.stringify({ version: 1, image: prepared.image, silentReferenceVideo: prepared.video, soundtrack }), { mode: 0o600 })
      const requestPath = resolve(dir, 'notoken-request.json')
      await writeFile(requestPath, JSON.stringify({
        prompt,
        imageFile: prepared.image.file,
        videoFile: prepared.video.file,
        imagePersonReference: template.imagePersonReference === true,
        videoPersonReference: template.videoPersonReference === true,
        durationSeconds: job.durationSeconds,
        aspectRatio: job.aspectRatio ?? template.aspectRatio,
        resolution: template.resolution,
        model: template.noTokenModel ?? process.env.NOTOKEN_VIDEO_MODEL ?? 'seedance-2.0-mini',
      }), { mode: 0o600 })
      return { run: requestPath, output: 'final.video' }
    },
    async check(path) {
      const request = JSON.parse(await readFile(path, 'utf8'))
      if (!request.prompt || !request.imageFile || !request.videoFile || !Number.isInteger(request.durationSeconds)) return { ok: false }
      return { ok: true }
    },
    async submit(path) {
      const request = JSON.parse(await readFile(path, 'utf8'))
      const dir = dirname(path)
      const imageUrl = await upload(resolve(dir, request.imageFile), 'image/png', 'reference.png')
      const videoUrl = await upload(resolve(dir, request.videoFile), 'video/mp4', 'reference.mp4')
      const content = [{ type: 'text', text: request.prompt }]
      content.push({ type: 'text', text: `Reference image; contains a person: ${request.imagePersonReference ? 'yes' : 'no'}.` })
      content.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' })
      content.push({ type: 'text', text: `Reference video; contains a person: ${request.videoPersonReference ? 'yes' : 'no'}.` })
      content.push({ type: 'video_url', video_url: { url: videoUrl }, role: 'reference_video' })
      try {
        const task = await json('/api/v3/contents/generations/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            content,
            duration: request.durationSeconds,
            ratio: request.aspectRatio,
            resolution: request.resolution,
          }),
        })
        const id = taskId(task)
        if (!id) throw new Error('NoToken accepted request without a task id')
        return id
      } catch (error) {
        if (error?.status >= 400 && error.status < 500) error.code = 'notoken_submission_rejected'
        throw error
      }
    },
    async status(id) {
      const task = await readTask(id)
      const state = taskState(task)
      if (state === 'unknown') throw new Error('NoToken returned an unknown task state')
      return state
    },
    async export(id, _output, path, input) {
      const task = await readTask(id)
      if (taskState(task) !== 'complete') throw new Error('NoToken task is not complete')
      const url = isTrustedUrl(resultUrl(task), hosts)
      const dir = dirname(path)
      const raw = resolve(dir, 'notoken-output.mp4')
      await download(url, raw, 250 * 1024 * 1024)
      const soundtrack = resolve(dir, 'source-audio.wav')
      const duration = String(input.durationSeconds)
      try {
        await runMedia(config.ffmpegPath ?? 'ffmpeg', [
          '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '2', '-filter_threads', '1', '-y',
          '-i', raw, '-i', soundtrack, '-map', '0:v:0', '-map', '1:a:0',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', duration, '-shortest', '-movflags', '+faststart', path,
        ], { timeout: 180_000, maxBuffer: 1024 * 1024, windowsHide: true })
      } catch {
        throw new Error('Video and reference soundtrack mux failed')
      }
      const file = await stat(path)
      if (!file.size || file.size > 100 * 1024 * 1024) throw new Error('Final video output too large')
    },
    async verify(path, input, template) {
      const result = await probe(path)
      const video = result.streams?.find((stream) => stream.codec_type === 'video')
      const audio = result.streams?.find((stream) => stream.codec_type === 'audio')
      const landscape = (input.aspectRatio ?? template.aspectRatio) === '16:9'
      if (!video || !audio || video.width !== (landscape ? 1280 : 720) || video.height !== (landscape ? 720 : 1280) ||
          !Number.isFinite(Number(result.format?.duration)) || Math.abs(Number(result.format.duration) - input.durationSeconds) > 0.1) throw new Error('Final video verification failed')
    },
    async cancel() { return false },
  }
}
