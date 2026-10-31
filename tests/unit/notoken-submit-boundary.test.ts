import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNoTokenRunner } from '../../services/hypit-bridge/src/notoken.mjs'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  vi.unstubAllEnvs()
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'notoken-submit-boundary-'))
  directories.push(dir)
  await writeFile(join(dir, 'image.png'), 'image bytes')
  await writeFile(join(dir, 'video.mp4'), 'video bytes')
  const request = join(dir, 'request.json')
  await writeFile(request, JSON.stringify({
    prompt: 'fixed prompt', imageFile: 'image.png', videoFile: 'video.mp4',
    imagePersonReference: true, videoPersonReference: true,
    durationSeconds: 5, aspectRatio: '9:16', resolution: '720p', model: 'seedance-2.0-mini',
  }))
  return request
}

function runner(fetcher: typeof fetch) {
  vi.stubEnv('NOTOKEN_API_KEY', 'x'.repeat(32))
  vi.stubEnv('NOTOKEN_BASE_URL', 'https://notoken.pro')
  return createNoTokenRunner({}, { fetcher, run: async () => ({ stdout: '{}' }) })
}

it('enters the submission boundary only after both media files upload and resolve', async () => {
  const events: string[] = []
  let uploadCount = 0
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : input.toString()).pathname
    if (path === '/api/v3/files/uploads') {
      uploadCount += 1
      events.push(`upload-${uploadCount}`)
      return Response.json({ id: `file-${uploadCount}` })
    }
    if (path.startsWith('/api/v3/files/')) {
      events.push(`resolve-${path.split('/').at(-1)}`)
      return Response.json({ url: `https://notoken.pro/media/${path.split('/').at(-1)}` })
    }
    if (path === '/api/v3/contents/generations/tasks') {
      events.push('create-task')
      return Response.json({ id: 'task_123' })
    }
    return Response.json({ error: 'unexpected endpoint' }, { status: 404 })
  })
  const onSubmissionStart = vi.fn(async () => { events.push('submission-boundary') })
  const id = await runner(fetcher as typeof fetch).submit(await fixture(), { onSubmissionStart })

  expect(id).toBe('task_123')
  expect(onSubmissionStart).toHaveBeenCalledOnce()
  expect(events).toEqual(['upload-1', 'resolve-file-1', 'upload-2', 'resolve-file-2', 'submission-boundary', 'create-task'])
})

it('does not cross the submission boundary when a media upload fails', async () => {
  const fetcher = vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 }))
  const onSubmissionStart = vi.fn()
  await expect(runner(fetcher as typeof fetch).submit(await fixture(), { onSubmissionStart }))
    .rejects.toMatchObject({ code: 'notoken_image_upload_failed' })
  expect(onSubmissionStart).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledOnce()
})
