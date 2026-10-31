export const ASSET_PIXELS: { min: number; max: number }

export function assetDimensions(width: number, height: number): { width: number; height: number }

export function extractReferenceAudio(options: {
  dir: string
  probe: (path: string) => Promise<{ format?: { duration?: string | number }; streams?: { codec_type: string; codec_name?: string; sample_rate?: string | number; channels?: number }[] }>
  config: { ffmpegPath?: string }
  durationSeconds: number
  run?: (file: string, args: string[], options: Record<string, unknown>) => Promise<unknown>
}): Promise<{ file: string; durationSeconds: number; codec: string }>

export function prepareModelMedia(options: {
  dir: string
  kind: 'image' | 'video'
  probe: (path: string) => Promise<{
    format?: { duration?: string | number }
    streams?: {
      codec_type: string
      width?: number
      height?: number
      side_data_list?: { rotation?: number }[]
      tags?: { rotate?: number }
    }[]
  }>
  config: { ffmpegPath?: string }
  durationSeconds?: number
  run?: (file: string, args: string[], options: Record<string, unknown>) => Promise<unknown>
}): Promise<{ file: string; kind: string; width: number; height: number; resized: boolean }>
