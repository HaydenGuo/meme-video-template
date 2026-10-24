import { site } from '#/config/site'
import { cleanSecret, isProduction } from '../util'
import { VideoProviderError } from './types'
import type { VideoProvider, VideoStatus } from './types'

export function createHypitProvider(env: Env): VideoProvider {
  const token = cleanSecret(env.HYPIT_BRIDGE_TOKEN) ?? ''
  let base: URL
  try {
    base = new URL(env.HYPIT_BRIDGE_URL)
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error()
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && !isProduction(env) && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error()
    if (token.length < 32) throw new Error()
  } catch {
    throw new VideoProviderError('hypit_not_configured', 'Hypit Bridge configuration invalid', false)
  }

  async function request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetch(new URL(path, base), {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
        redirect: 'manual',
      })
    } catch {
      throw new VideoProviderError('hypit_unavailable', 'Hypit Bridge unavailable', true)
    }
    const data = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok || !data) {
      // 不把远端报错正文写入日志或积分流水，里面可能包含媒体签名地址。
      throw new VideoProviderError(`hypit_http_${response.status}`, `Hypit Bridge HTTP ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500)
    }
    return data
  }

  return {
    id: 'hypit',
    async submit(input) {
      const job = await request('/v1/jobs', {
        generationId: input.generationId,
        siteId: env.HYPIT_SITE_ID,
        templateId: site.video.hypit.templateId,
        durationSeconds: input.durationSeconds,
        aspectRatio: input.aspectRatio ?? '9:16',
        imageUrl: input.imageUrl,
        sourceVideoUrl: input.sourceVideoUrl,
      })
      if (job.mode !== 'hypit' && isProduction(env)) throw new VideoProviderError('hypit_mock_forbidden', 'Non-generating Hypit Bridge cannot serve production', false)
      if (typeof job.id !== 'string' || !/^[a-f0-9]{64}$/.test(job.id)) throw new VideoProviderError('hypit_protocol', 'Invalid Hypit job receipt', true)
      return { requestId: job.id, meta: {} }
    },
    async status(id): Promise<VideoStatus> {
      const job = await request(`/v1/jobs/${encodeURIComponent(id)}`)
      if (job.mode !== 'hypit' && isProduction(env)) throw new VideoProviderError('hypit_mock_forbidden', 'Non-generating Hypit Bridge cannot serve production', false)
      if (job.state === 'pending') return { state: 'pending' }
      if (job.state === 'failed') return { state: 'failed', code: 'hypit_failed', message: 'Hypit generation failed' }
      if (job.state !== 'completed' || typeof job.outputUrl !== 'string') throw new VideoProviderError('hypit_protocol', 'Invalid Hypit job status', true)
      const output = new URL(job.outputUrl)
      // 成品只允许从当前 Bridge 的签名下载端点读取。
      if (output.origin !== base.origin || output.pathname !== `/v1/jobs/${id}/output`) throw new VideoProviderError('hypit_protocol', 'Invalid Hypit output URL', false)
      return { state: 'completed', output: { url: output.href } }
    },
    costCents: (seconds) => Math.round(seconds * site.video.hypit.costCentsPerSecond),
  }
}
