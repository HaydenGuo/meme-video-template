import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

const exec = promisify(execFile)
// Ark CreateAsset 的像素限制；归一化目标留出偶数取整的余量。
export const ASSET_PIXELS = { min: 407696, max: 8295044 }

export function assetDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('Invalid media dimensions')
  const pixels = width * height
  const target = pixels < ASSET_PIXELS.min ? 512000 : pixels > ASSET_PIXELS.max ? 8000000 : pixels
  const factor = Math.sqrt(target / pixels)
  const w = Math.max(2, Math.round(width * factor / 2) * 2)
  const h = Math.max(2, Math.round(height * factor / 2) * 2)
  if (w > 8192 || h > 8192 || w * h < ASSET_PIXELS.min || w * h > ASSET_PIXELS.max) throw new Error('Unsupported media dimensions')
  return { width: w, height: h }
}

export async function extractReferenceAudio({ dir, probe, config, durationSeconds, run = exec }) {
  const input = resolve(dir, 'source.mp4')
  const output = resolve(dir, 'source-audio.wav')
  const before = await probe(input)
  if (!before.streams?.some(s => s.codec_type === 'audio')) throw new Error('Reference soundtrack missing')
  try {
    await run(config.ffmpegPath ?? 'ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '2', '-filter_threads', '1', '-y',
      '-i', input, '-map', '0:a:0', '-vn', '-af', 'asetpts=PTS-STARTPTS', '-t', String(durationSeconds), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', output,
    ], { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true })
  } catch {
    throw new Error('Reference soundtrack extraction failed before submission')
  }
  const after = await probe(output)
  const length = Number(after.format?.duration)
  if (!after.streams?.some(s => s.codec_type === 'audio') || after.streams.some(s => s.codec_type === 'video') || !Number.isFinite(length) || Math.abs(length - durationSeconds) > 0.1) {
    throw new Error('Extracted soundtrack invalid')
  }
  return { file: 'source-audio.wav', durationSeconds: length, codec: 'pcm_s16le' }
}

export async function prepareModelMedia({ dir, kind, probe, config, durationSeconds, run = exec }) {
  const input = resolve(dir, kind === 'image' ? 'image.png' : 'source.mp4')
  const before = await probe(input)
  const stream = before.streams?.find(s => s.codec_type === 'video')
  const rotation = Number(stream?.side_data_list?.find(s => s.rotation != null)?.rotation ?? stream?.tags?.rotate ?? 0)
  const swap = Math.abs(rotation % 180) === 90
  const width = swap ? stream?.height : stream?.width
  const height = swap ? stream?.width : stream?.height
  const target = assetDimensions(width, height)
  if (kind === 'video' && (!Number.isFinite(Number(before.format?.duration)) || Math.abs(Number(before.format.duration) - durationSeconds) > 0.1)) throw new Error('Reference duration invalid before submission')
  const resized = width !== target.width || height !== target.height
  const file = kind === 'image' ? 'model-image.png' : 'model-source.mp4'
  // 模型只接收不含音轨的派生视频；原片保留给音频提取和最终合成。
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '2', '-filter_threads', '1', '-y', '-i', input, '-map', '0:v:0', '-vf', `scale=${target.width}:${target.height}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS`, '-map_metadata', '-1']
  if (kind === 'image') args.push('-frames:v', '1', '-pix_fmt', 'rgb24')
  else args.push('-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart')
  args.push(resolve(dir, file))
  try {
    await run(config.ffmpegPath ?? 'ffmpeg', args, { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true })
  } catch {
    // 不把 ffmpeg 的文件路径和用户素材信息泄漏给接口。
    throw new Error('Media preparation failed before submission')
  }
  const after = await probe(resolve(dir, file))
  const video = after.streams?.find(s => s.codec_type === 'video')
  if (kind === 'video' && after.streams?.some(s => s.codec_type === 'audio')) throw new Error('Prepared reference video must be silent')
  const pixels = video?.width * video?.height
  if (video?.width !== target.width || video?.height !== target.height || !(pixels >= ASSET_PIXELS.min && pixels <= ASSET_PIXELS.max)) throw new Error('Prepared media dimensions invalid')
  if (kind === 'video' && (!Number.isFinite(Number(after.format?.duration)) || Math.abs(Number(after.format.duration) - durationSeconds) > 0.1)) throw new Error('Prepared reference duration invalid')
  return { file, kind, width: video.width, height: video.height, resized }
}
