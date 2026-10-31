export interface TemplateMediaFile {
  bucket: string
  source: string
  path: string
  size: number
}

export function configuredTemplateMedia(
  config: { r2_buckets?: readonly { binding: string; bucket_name: string }[] },
  durations: readonly { source: string }[],
  projectRoot?: string,
): TemplateMediaFile[]

export function verifyTemplateMedia(options: {
  siteUrl: string
  files: readonly TemplateMediaFile[]
  fetcher?: (input: URL, init?: RequestInit) => Promise<Response>
}): Promise<{ source: string; status: number; size: number }[]>
