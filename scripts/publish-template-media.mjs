#!/usr/bin/env node
// Keep the production R2 bucket in sync with the source clips configured by site.durations.
// The Worker serves these objects from /media/templates/ and Hypit Bridge downloads them
// from that public route before it can create a model Build.
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { site } from '../src/config/site.ts'
import { readWranglerConfig } from './doctor.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))

export function configuredTemplateMedia(config, durations, projectRoot = root) {
  const bucket = config.r2_buckets?.find((binding) => binding.binding === 'MEDIA')?.bucket_name
  if (typeof bucket !== 'string' || !bucket.trim()) throw new Error('wrangler config is missing the MEDIA R2 bucket')

  const sources = [...new Set(durations.map((duration) => duration.source))]
  if (!sources.length) throw new Error('site.durations contains no template video sources')

  return sources.map((source) => {
    if (typeof source !== 'string' || !/^[\w.-]+$/.test(source)) throw new Error(`Invalid template video filename: ${String(source)}`)
    const path = resolve(projectRoot, 'seed', 'templates', source)
    let size
    try {
      size = statSync(path).size
    } catch {
      throw new Error(`Configured template video is missing: seed/templates/${source}`)
    }
    if (!size) throw new Error(`Configured template video is empty: seed/templates/${source}`)
    return { bucket, source, path, size }
  })
}

export async function verifyTemplateMedia({ siteUrl, files, fetcher = fetch }) {
  const origin = new URL(siteUrl)
  if (origin.protocol !== 'https:') throw new Error('Template media verification requires an HTTPS SITE_URL')

  const results = []
  for (const file of files) {
    const url = new URL(`/media/templates/${encodeURIComponent(file.source)}`, origin)
    const response = await fetcher(url, { headers: { Range: 'bytes=0-0' } })
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`${file.source}: expected HTTP 206 for a one-byte Range request, received ${response.status}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    const contentRange = response.headers.get('content-range') ?? ''
    if (!contentType.toLowerCase().startsWith('video/mp4')) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`${file.source}: expected video/mp4, received ${contentType || '(missing content-type)'}`)
    }
    if (contentRange !== `bytes 0-0/${file.size}`) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`${file.source}: unexpected Content-Range ${contentRange || '(missing)'}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== 1) throw new Error(`${file.source}: one-byte Range response contained ${bytes.byteLength} bytes`)
    results.push({ source: file.source, status: response.status, size: file.size })
  }
  return results
}

function parseArgs(args) {
  const [action, ...rest] = args
  const configIndex = rest.indexOf('--config')
  const configFile = configIndex >= 0 ? rest[configIndex + 1] : 'wrangler.jsonc'
  if (configIndex >= 0 && !configFile) throw new Error('--config requires a file path')
  if (rest.some((argument, index) => argument === '--config' && index !== configIndex)) throw new Error('Use --config only once')
  if (!['publish', 'verify'].includes(action)) throw new Error('Usage: node scripts/publish-template-media.mjs <publish|verify> [--config wrangler.jsonc]')
  return { action, configFile: resolve(configFile) }
}

async function main(args) {
  const { action, configFile } = parseArgs(args)
  const config = readWranglerConfig(configFile)
  const files = configuredTemplateMedia(config, site.durations)
  if (action === 'publish') {
    for (const file of files) {
      const result = spawnSync(process.execPath, [
        wranglerBin,
        'r2', 'object', 'put', `${file.bucket}/templates/${file.source}`,
        '--file', file.path,
        '--content-type', 'video/mp4',
        '--remote',
        '--config', configFile,
      ], { cwd: root, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`Could not upload ${file.source} to the MEDIA bucket`)
    }
    return
  }

  const siteUrl = config.vars?.SITE_URL
  if (typeof siteUrl !== 'string' || !siteUrl) throw new Error('wrangler config is missing SITE_URL')
  for (const result of await verifyTemplateMedia({ siteUrl, files })) {
    console.log(`${result.source}: HTTP ${result.status}, Range 1/${result.size} bytes`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Template media operation failed')
    process.exitCode = 1
  })
}
