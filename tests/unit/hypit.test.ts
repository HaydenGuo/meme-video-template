import { afterEach, expect, it, vi } from 'vitest'
import { createHypitProvider } from '#/server/video/hypit'
import { activeVideoProviderId } from '#/server/video'
import { site } from '#/config/site'

const env = { APP_ENV: 'development', VIDEO_PROVIDER: 'hypit', HYPIT_BRIDGE_URL: 'http://127.0.0.1:8788', HYPIT_SITE_ID: 'shrimpreel', HYPIT_BRIDGE_TOKEN: 'x'.repeat(40) } as unknown as Env
const input = { generationId: 'gen_1', durationSeconds: 5, imageUrl: 'https://site.test/image', sourceVideoUrl: 'https://site.test/video', sourceVideoKey: 'templates/source.mp4', webhookUrl: '', meta: {} }
const id = 'a'.repeat(64)
afterEach(() => vi.unstubAllGlobals())
it('提交保留生成 ID，查询成品只接受当前 Bridge 的签名端点', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id, mode: 'hypit' }))
    .mockResolvedValueOnce(Response.json({ state: 'completed', mode: 'hypit', outputUrl: `http://127.0.0.1:8788/v1/jobs/${id}/output?sig=x` }))
    .mockResolvedValueOnce(Response.json({ state: 'completed', mode: 'hypit', outputUrl: 'https://attacker.test/file' }))
  vi.stubGlobal('fetch', fetch)
  expect(activeVideoProviderId(env)).toBe('hypit')
  const provider = createHypitProvider(env)
  expect((await provider.submit(input)).requestId).toBe(id)
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ generationId: 'gen_1', siteId: env.HYPIT_SITE_ID, templateId: site.video.hypit.templateId })
  expect(await provider.status(id, {})).toMatchObject({ state: 'completed' })
  await expect(provider.status(id, {})).rejects.toMatchObject({ code: 'hypit_protocol', retryable: false })
})
it('站点声明必需复刻工作流时将要求传给 Bridge', async () => {
  const config = { ...site, video: { ...site.video, hypit: { ...site.video.hypit, requiredWorkflowType: 'reference-remix-v1' } } } as typeof site
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id, mode: 'hypit' }))
  vi.stubGlobal('fetch', fetch)
  await createHypitProvider(env, config).submit(input)
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ requiredWorkflowType: 'reference-remix-v1' })
})
it('重试网络错误与限流，不把远端敏感报错传入日志', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ secret: 'sensitive' }, { status: 429 })).mockRejectedValueOnce(new Error('sensitive')))
  const provider = createHypitProvider(env)
  await expect(provider.submit(input)).rejects.toMatchObject({ retryable: true, message: 'Hypit Bridge HTTP 429' })
  await expect(provider.submit(input)).rejects.toMatchObject({ retryable: true, message: 'Hypit Bridge unavailable' })
})
it('正式环境拒绝本机地址和模拟/透传 Bridge', async () => {
  expect(() => createHypitProvider({ ...env, APP_ENV: 'production' })).toThrow()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id, mode: 'passthrough' })))
  const provider = createHypitProvider({ ...env, APP_ENV: 'production', HYPIT_BRIDGE_URL: 'https://bridge.test' })
  await expect(provider.submit(input)).rejects.toMatchObject({ code: 'hypit_mock_forbidden' })
})
