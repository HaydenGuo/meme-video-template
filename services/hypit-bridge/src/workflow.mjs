// 固定工程生成器：输入来自服务端模板配置，不调用语言模型，也不自动修改提示词。
export function remixComposition(job, template, pictureSource) {
  const workflow = template.workflow
  if (workflow?.type !== 'reference-remix-v1' || workflow.frameRate !== 30) throw new Error('Unsupported workflow')
  const end = job.durationSeconds * 30
  const cuts = workflow.cutFrames
  if (!Array.isArray(cuts) || cuts[0] !== 0 || cuts.some((n, i) => !Number.isSafeInteger(n) || n < 0 || (i && n <= cuts[i - 1]))) throw new Error('Invalid workflow cuts')
  const starts = cuts.filter((n) => n < end)
  const windows = starts.map((start, i) => ({ id: `shot${i}`, start, length: (starts[i + 1] ?? end) - start }))
  const landscape = (job.aspectRatio ?? template.aspectRatio) === '16:9'
  return { imports: `
  <import as="mediaop" from="@hypit/media-operations@1"/>
  <import as="time" from="@hypit/timeline-author@1"/>
  <import as="space" from="@hypit/spatial@1"/>
  <import as="visual" from="@hypit/visual-track@1"/>
  <import as="audio" from="@hypit/audio-track@1"/>
  <import as="film" from="@hypit/film@1"/>
  <import as="html" from="@hypit/html-video@1"/>
  <import as="look" source="./look.svs"/>`, body: `
  <time:Clock id="clock" frame-rate="30"/>
  <mediaop:Normalize id="picture-media" source={${pictureSource}} clock={clock} video="primary-moving" audio="none" span-authority="video"/>
  <mediaop:Normalize id="music-media" source={reference} clock={clock} video="none" audio="default" span-authority="audio"/>
  <space:Canvas id="canvas" width="${landscape ? 1280 : 720}" height="${landscape ? 720 : 1280}"/>
  <space:Frame id="full" within={canvas.bounds} left="0%" top="0%" right="100%" bottom="100%"/>
  <time:Timeline id="program" clock={clock} end="${end}f">
${windows.map((w) => `    <time:Window id="${w.id}" from="${w.start}f" for="${w.length}f"/>`).join('\n')}
  </time:Timeline>
  <visual:Track id="picture" timeline={program.timeline}>
${windows.map((w) => `    <visual:Clip id="${w.id}" media={picture-media.media} during={program.${w.id}} frame={full} z="10" fit="contain"><visual:Map target-at="start" source-at="${w.start}f" rate="1"/></visual:Clip>`).join('\n')}
  </visual:Track>
  <audio:Track id="music" timeline={program.timeline}>
    <audio:Clip id="original" source={music-media.media} during={program.window} gain="1"/>
  </audio:Track>
  <film:Film id="main" canvas={canvas.canvas} timeline={program.timeline} appearance={look.film.main}>
    <film:Track source={picture.visual}/><film:Track source={music.audio}/>
  </film:Film>
  <html:Video id="final" composition={main.composition} timeline={program.timeline}/>` }
}
