import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractReferenceAudio, prepareModelMedia } from '../../services/hypit-bridge/src/media-preflight.mjs'
import { referenceMediaMarkup, remixComposition } from '../../services/hypit-bridge/src/workflow.mjs'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = join(tmpdir(), `hypit-reference-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

describe('Hypit reference video soundtrack workflow', () => {
  it('extracts the original soundtrack as a separate audio-only WAV before submission', async () => {
    const dir = tempDir()
    const probe = vi.fn(async (path: string) => path.endsWith('.wav')
      ? { format: { duration: '5.0' }, streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le' }] }
      : { streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] })
    const run = vi.fn(async (_binary: string, _args: string[]) => ({ stdout: '', stderr: '' }))

    await expect(extractReferenceAudio({ dir, probe, config: {}, durationSeconds: 5, run })).resolves.toMatchObject({
      file: 'source-audio.wav', durationSeconds: 5, codec: 'pcm_s16le',
    })
    expect(run).toHaveBeenCalledOnce()
    const args = run.mock.calls[0][1] as string[]
    expect(args).toContain('-map')
    expect(args).toContain('0:a:0')
    expect(args).toContain('-vn')
    expect(args).toContain('pcm_s16le')
    expect(args.at(-1)).toBe(resolve(dir, 'source-audio.wav'))
  })

  it('always creates a silent model-reference video, including when no resize is needed', async () => {
    const dir = tempDir()
    const probe = vi.fn(async (path: string) => ({
      format: { duration: '5.0' },
      streams: path.endsWith('model-source.mp4')
        ? [{ codec_type: 'video', width: 720, height: 1280 }]
        : [{ codec_type: 'video', width: 720, height: 1280 }, { codec_type: 'audio' }],
    }))
    const run = vi.fn(async (_binary: string, _args: string[]) => ({ stdout: '', stderr: '' }))

    await expect(prepareModelMedia({ dir, kind: 'video', probe, config: {}, durationSeconds: 5, run })).resolves.toMatchObject({
      file: 'model-source.mp4', resized: false,
    })
    const args = run.mock.calls[0][1] as string[]
    expect(args).toContain('-an')
    expect(args).not.toContain('0:a?')
    expect(probe).toHaveBeenCalledWith(resolve(dir, 'model-source.mp4'))
  })

  it('composes the extracted soundtrack with the generated picture', () => {
    const result = remixComposition(
      { durationSeconds: 5, aspectRatio: '9:16' },
      { workflow: { type: 'reference-remix-v1', frameRate: 30, cutFrames: [0] }, aspectRatio: '9:16' },
      'generated.video',
    )
    expect(result.body).toContain('source={soundtrack}')
    expect(result.body).toContain('source={music-media.media}')
    expect(result.body).not.toContain('source={reference}')
  })

  it('declares an audio-only soundtrack and silent model reference as separate media', () => {
    const markup = referenceMediaMarkup({ hasWorkflow: true, passthrough: false, modelVideoFile: 'model-source.mp4' })
    expect(markup).toContain('<media:Audio id="soundtrack" src="./source-audio.wav"/>')
    expect(markup).toContain('<media:Video id="model-reference" src="./model-source.mp4"/>')
    expect(markup).not.toContain('id="reference"')
  })
})
