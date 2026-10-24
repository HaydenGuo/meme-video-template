import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { remixComposition } from './workflow.mjs'

const exec = promisify(execFile)
const xml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
const unsubmittedErrorPrefixes = ['MARKUP_']

// 这些错误来自参数解析或本地 Source/Run 编译，Hypit 尚未进入提交边界。
// 其它 CLI_ERROR（包括 Runtime、凭据、Provider 和网络错误）必须保留为未知回执。
function isKnownUnsubmittedCliError(result) {
  const code = result?.format === 'hypit.cli-error@1' ? result.error?.code : undefined
  return typeof code === 'string' && (code === 'CLI_USAGE' || unsubmittedErrorPrefixes.some((prefix) => code.startsWith(prefix)))
}

// 只运行服务端安装的固定 CLI，不接受浏览器提供的命令、路径或 SVML。
export function createHypitRunner(config) {
  const project = resolve(config.projectRoot)
  const cli = resolve(project, 'node_modules/@hypit/hypit/bin/hypit.mjs')
  async function command(args) {
    const scope = ['build', 'status', 'cancel'].includes(args[0]) ? ['--runtime', resolve(config.runtimeProfile)] : []
    const { stdout } = await exec(process.execPath, [cli, ...args, '--project', project, ...scope, '--json'], {
      cwd: project, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true,
    }).catch((error) => {
      // status 的失败 Build 也会返回合法 JSON 和非零退出码。
      if (error.stdout) return { stdout: error.stdout }
      throw new Error('Hypit CLI unavailable')
    })
    return JSON.parse(stdout)
  }
  async function probe(path) {
    const { stdout } = await exec(config.ffprobePath ?? 'ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true })
    return JSON.parse(stdout)
  }
  return {
    async prepare(job, template, dir) {
      await mkdir(dir, { recursive: true })
      const passthrough = config.mode === 'passthrough'
      const background = job.backgroundDescription?.trim()
      const prompt = background
        ? `${template.prompt}\n\nBackground setting (replace the reference background only; keep the character, choreography and camera movement): ${background}`
        : template.prompt
      const composition = template.workflow ? remixComposition(job, template, passthrough ? 'reference' : 'generated.video') : null
      if (template.workflow) {
        const input = await probe(resolve(dir, 'source.mp4'))
        const length = Number(input.format?.duration)
        if (!Number.isFinite(length) || Math.abs(length - job.durationSeconds) > 0.1 || !input.streams?.some((s) => s.codec_type === 'video') || !input.streams.some((s) => s.codec_type === 'audio')) throw new Error('Reference duration or soundtrack invalid')
        const expected = template.referenceHashes?.[job.durationSeconds]
        const actual = createHash('sha256').update(await readFile(resolve(dir, 'source.mp4'))).digest('hex')
        if (!expected || actual !== expected) throw new Error('Reference differs from approved template')
        const image = await probe(resolve(dir, 'image.png'))
        if (!image.streams?.some((s) => s.codec_type === 'video' && s.width > 0 && s.height > 0)) throw new Error('Invalid portrait')
      }
      const source = `<?svml using="@hypit/markup@1"?>
<svml>
  <import as="media" from="@hypit/media@1"/>
${composition?.imports ?? ''}
${passthrough ? composition ? '  <media:Video id="reference" src="./source.mp4"/>' : `  <import as="time" from="@hypit/timeline-author@1"/>
  <import as="mediaop" from="@hypit/media-operations@1"/>
  <media:Video id="reference" src="./source.mp4"/>
  <time:Clock id="clock" frame-rate="24"/>
  <mediaop:Normalize id="normalized" source={reference} clock={clock} video="primary-moving" audio="none" span-authority="video"/>
  <mediaop:Transform id="prepared" source={normalized.media}><mediaop:Retime rate="1"/></mediaop:Transform>` : `  <import as="text" from="@hypit/text@1"/>
  <import as="seedance" from="@hypit/seedance@1"/>
  <media:Video id="reference" src="./source.mp4"/>
  <media:Image id="portrait" src="./image.png" media-type="${xml(job.imageMediaType ?? 'image/png')}"/>
  <text:Value id="direction">${xml(prompt)}</text:Value>
  <seedance:ReferenceVideo id="generated" model="${xml(template.model)}" prompt={direction} duration="${job.durationSeconds}" resolution="${xml(template.resolution)}" aspect-ratio="${xml(job.aspectRatio ?? template.aspectRatio)}" generate-audio="false">
    <seedance:Reference image={portrait} person-reference="${template.imagePersonReference === true}"/>
    <seedance:Reference video={reference} person-reference="${template.videoPersonReference === true}"/>
  </seedance:ReferenceVideo>`}
${composition?.body ?? ''}
</svml>`
      const output = template.workflow ? 'final.video' : passthrough ? 'prepared.video' : 'generated.video'
      if (template.workflow) await writeFile(resolve(dir, 'look.svs'), '<?svml using="@hypit/recipe@1"?>\n<sheet version="1">film.main { background: #090D14; }</sheet>')
      await writeFile(resolve(dir, 'source.svml'), source)
      await writeFile(resolve(dir, 'run.svrun'), `<?svml using="@hypit/markup/run@1"?>\n<svrun version="1"><author source="./source.svml"/><target output="${output}"/></svrun>`)
      return { run: resolve(dir, 'run.svrun'), output }
    },
    async check(run) { return command(['check', run]) },
    async submit(run, id) {
      const result = await command(['build', run, '--title', `bridge:${id}`])
      if (!result.build?.id) {
        if (isKnownUnsubmittedCliError(result)) {
          const error = new Error(`Hypit rejected the Build before submission (${result.error.code})`)
          error.code = 'hypit_submission_rejected'
          throw error
        }
        throw new Error('Hypit submission receipt missing')
      }
      return result.build.id
    },
    async status(buildId) {
      const result = await command(['status', buildId])
      if (!result.build) throw new Error('Hypit Build not found')
      return result.build.result?.state
    },
    async inspect(buildId) { return command(['status', buildId]) },
    async export(buildId, output, path) {
      const result = await command(['get', buildId, '--output', output, '--to', path])
      if (result.error) throw new Error('Hypit export failed')
    },
    async verify(path, input, template) {
      if (!template.workflow) return
      const result = await probe(path)
      const video = result.streams?.find((s) => s.codec_type === 'video')
      const audio = result.streams?.find((s) => s.codec_type === 'audio')
      const landscape = (input.aspectRatio ?? template.aspectRatio) === '16:9'
      if (!video || !audio || video.width !== (landscape ? 1280 : 720) || video.height !== (landscape ? 720 : 1280) || !Number.isFinite(Number(result.format?.duration)) || Math.abs(Number(result.format.duration) - input.durationSeconds) > 0.1) throw new Error('Output verification failed')
    },
    async cancel(buildId) { await command(['cancel', buildId, '--reason', 'Bridge deadline exceeded']) },
  }
}
