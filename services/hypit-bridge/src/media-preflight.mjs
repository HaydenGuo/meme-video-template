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

export async function prepareModelMedia({ dir, kind, probe, config, durationSeconds }) {
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
  // 人像始终转为真正的 PNG，避免扩展名与原上传 MIME 不一致；原文件不覆盖。
  if (kind === 'video' && !resized && rotation === 0) return { file: 'source.mp4', kind, width, height, resized: false }
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '2', '-filter_threads', '1', '-y', '-i', input, '-map', '0:v:0', '-vf', `scale=${target.width}:${target.height}:flags=lanczos,setsar=1`, '-map_metadata', '-1']
  if (kind === 'image') args.push('-frames:v', '1', '-pix_fmt', 'rgb24')
  else args.push('-map', '0:a?', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart')
  args.push(resolve(dir, file))
  try {
    await exec(config.ffmpegPath ?? 'ffmpeg', args, { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true })
  } catch {
    // 不把 ffmpeg 的文件路径和用户素材信息泄漏给接口。
    throw new Error('Media preparation failed before submission')
  }
  const after = await probe(resolve(dir, file))
  const video = after.streams?.find(s => s.codec_type === 'video')
  const pixels = video?.width * video?.height
  if (video?.width !== target.width || video?.height !== target.height || !(pixels >= ASSET_PIXELS.min && pixels <= ASSET_PIXELS.max)) throw new Error('Prepared media dimensions invalid')
  if (kind === 'video' && (!Number.isFinite(Number(after.format?.duration)) || Math.abs(Number(after.format.duration) - durationSeconds) > 0.1)) throw new Error('Prepared reference duration invalid')
  return { file, kind, width: video.width, height: video.height, resized }
}
