import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { configuredTemplateMedia, verifyTemplateMedia } from '../../scripts/publish-template-media.mjs'

describe('production template media', () => {
  it('collects each configured source once from the MEDIA bucket', () => {
    const root = mkdtempSync(join(tmpdir(), 'template-media-'))
    try {
      mkdirSync(join(root, 'seed', 'templates'), { recursive: true })
      writeFileSync(join(root, 'seed', 'templates', 'dance-5s.mp4'), Buffer.from([1, 2, 3]))
      const files = configuredTemplateMedia(
        { r2_buckets: [{ binding: 'MEDIA', bucket_name: 'site-media' }] },
        [{ source: 'dance-5s.mp4' }, { source: 'dance-5s.mp4' }],
        root,
      )
      expect(files).toHaveLength(1)
      expect(files[0]).toMatchObject({ bucket: 'site-media', source: 'dance-5s.mp4', size: 3 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an absent configured reference before deployment', () => {
    expect(() => configuredTemplateMedia(
      { r2_buckets: [{ binding: 'MEDIA', bucket_name: 'site-media' }] },
      [{ source: 'missing.mp4' }],
      tmpdir(),
    )).toThrow('Configured template video is missing')
  })

  it('checks public video Range delivery with the same one-byte request used by Bridge', async () => {
    const fetcher = vi.fn(async (_input: URL, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Range: 'bytes=0-0' })
      return new Response(Uint8Array.of(0), {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-0/321' },
      })
    })
    const files = [{ source: 'dance-5s.mp4', size: 321, bucket: 'site-media', path: 'unused' }]
    await expect(verifyTemplateMedia({ siteUrl: 'https://site.example', files, fetcher })).resolves.toEqual([
      { source: 'dance-5s.mp4', status: 206, size: 321 },
    ])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(String(fetcher.mock.calls[0][0])).toBe('https://site.example/media/templates/dance-5s.mp4')
  })

  it('fails deployment verification if the reference source is missing', async () => {
    const files = [{ source: 'dance-5s.mp4', size: 321, bucket: 'site-media', path: 'unused' }]
    await expect(verifyTemplateMedia({
      siteUrl: 'https://site.example',
      files,
      fetcher: async () => new Response('Not found', { status: 404 }),
    })).rejects.toThrow('expected HTTP 206')
  })
})
