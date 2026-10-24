import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const exec = promisify(execFile)
const xml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

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
  return {
    async prepare(job, template, dir) {
      await mkdir(dir, { recursive: true })
      const passthrough = config.mode === 'passthrough'
      const source = `<?svml using="@hypit/markup@1"?>
<svml>
  <import as="media" from="@hypit/media@1"/>
${passthrough ? `  <import as="time" from="@hypit/timeline-author@1"/>
  <import as="mediaop" from="@hypit/media-operations@1"/>
  <media:Video id="reference" src="./source.mp4"/>
  <time:Clock id="clock" frame-rate="24"/>
  <mediaop:Normalize id="normalized" source={reference} clock={clock} video="primary-moving" audio="none" span-authority="video"/>
  <mediaop:Transform id="prepared" source={normalized.media}><mediaop:Retime rate="1"/></mediaop:Transform>` : `  <import as="text" from="@hypit/text@1"/>
  <import as="seedance" from="@hypit/seedance@1"/>
  <media:Video id="reference" src="./source.mp4"/>
  <media:Image id="portrait" src="./image.png" media-type="${xml(job.imageMediaType ?? 'image/png')}"/>
  <text:Value id="direction">${xml(template.prompt)}</text:Value>
  <seedance:ReferenceVideo id="generated" model="${xml(template.model)}" prompt={direction} duration="${job.durationSeconds}" resolution="${xml(template.resolution)}" aspect-ratio="${xml(job.aspectRatio ?? template.aspectRatio)}" generate-audio="false">
    <seedance:Reference image={portrait} person-reference="${template.imagePersonReference === true}"/>
    <seedance:Reference video={reference} person-reference="${template.videoPersonReference === true}"/>
  </seedance:ReferenceVideo>`}
</svml>`
      const output = passthrough ? 'prepared.video' : 'generated.video'
      await writeFile(resolve(dir, 'source.svml'), source)
      await writeFile(resolve(dir, 'run.svrun'), `<?svml using="@hypit/markup/run@1"?>\n<svrun version="1"><author source="./source.svml"/><target output="${output}"/></svrun>`)
      return { run: resolve(dir, 'run.svrun'), output }
    },
    async check(run) { return command(['check', run]) },
    async submit(run, id) {
      const result = await command(['build', run, '--title', `bridge:${id}`])
      if (!result.build?.id) throw new Error('Hypit submission receipt missing')
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
    async cancel(buildId) { await command(['cancel', buildId, '--reason', 'Bridge deadline exceeded']) },
  }
}
