import { createFileRoute } from '@tanstack/react-router'
import { ArrowRight, Camera, Check, Clock, Coins, Film, ShieldCheck, Smartphone, X } from 'lucide-react'
import { Faq, faqJsonLd } from '#/components/Faq'
import { Generator } from '#/components/Generator'
import { Pricing } from '#/components/Pricing'
import { VideoCard } from '#/components/VideoCard'
import { LocalLink } from '#/components/ui'
import { articlePath, formatPrice, site } from '#/config/site'
import { getContent, localeFromParam, pageHead, useContent } from '#/lib/i18n'
import { homeJsonLd, jsonLdScript } from '#/lib/seo'

export const Route = createFileRoute('/{-$locale}/')({
  head: ({ params }) => {
    const locale = localeFromParam(params.locale)
    const c = getContent(locale)
    const head = pageHead(locale, '/', c.meta.homeTitle, c.meta.homeDescription)
    return {
      ...head,
      scripts: [
        jsonLdScript(homeJsonLd(locale, c.meta.homeDescription, { name: `${c.hero.aiVersion} – ${site.keyword}`, description: c.madeWith.body })),
        jsonLdScript(faqJsonLd(c.faq.items)),
      ],
    }
  },
  component: Home,
})

const FEATURE_ICONS = [Camera, Film, Smartphone, Clock, ShieldCheck, Coins]

function Home() {
  const c = useContent()
  const ex = site.examples
  const heroYoutube = ex.original.youtube
  const heroYoutubeSrc = heroYoutube?.videoId ? youtubeEmbedUrl(heroYoutube) : null
  const originalAspectRatio = 'aspectRatio' in ex.original && typeof ex.original.aspectRatio === 'string' ? ex.original.aspectRatio : '9 / 16'
  const [exampleWidth, exampleHeight] = site.template.aspectRatio.split(':').map(Number)
  const exampleAspectRatio = Number.isFinite(exampleWidth) && Number.isFinite(exampleHeight) && exampleWidth > 0 && exampleHeight > 0
    ? `${exampleWidth} / ${exampleHeight}`
    : '16 / 9'
  const portraitExamples = Number.isFinite(exampleWidth) && Number.isFinite(exampleHeight) && exampleHeight > exampleWidth
  const exampleVideos = [ex.madeWith, ...ex.additional, ...ex.gallery]
  return (
    <>
      {/* 首屏先介绍目标关键词，再引导用户制作视频。 */}
      <section className="relative overflow-hidden">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="container-page relative grid gap-10 py-10 lg:grid-cols-[minmax(0,430px)_1fr] lg:gap-16 lg:py-14">
          <div className="flex flex-col justify-center space-y-5" data-testid="keyword-intro">
            <h1 className="font-display text-5xl leading-[1.04] tracking-tight sm:text-6xl">{c.hero.title}</h1>
            <p className="text-lg leading-8 text-muted">{c.hero.subtitle}</p>
            <a href="#create" className="btn-primary w-fit">{c.finalCta.cta} <ArrowRight className="size-4" /></a>
          </div>
          <div className="flex flex-col justify-center gap-5">
            <div className={`mx-auto w-full ${heroYoutube || originalAspectRatio !== '9 / 16' ? 'max-w-2xl' : 'max-w-sm'}`}>
              {heroYoutubeSrc ? (
                <figure>
                  <div style={{ aspectRatio: '16 / 9' }} className="overflow-hidden rounded-2xl bg-bg-soft shadow-sm ring-1 ring-line">
                    <iframe
                      className="size-full"
                      src={heroYoutubeSrc}
                      title={c.hero.original}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                </figure>
              ) : (
                <VideoCard video={ex.original.video} poster={ex.original.poster} label={c.hero.original} aspectRatio={originalAspectRatio} fit="contain" />
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm font-medium">
              <LocalLink to={articlePath('trend')} className="inline-flex items-center gap-1.5 hover:text-accent">
                {c.articles.trend.title} <ArrowRight className="size-4" />
              </LocalLink>
              <LocalLink to={articlePath('howTo')} className="inline-flex items-center gap-1.5 hover:text-accent">
                {c.articles.howTo.title} <ArrowRight className="size-4" />
              </LocalLink>
            </div>
          </div>
        </div>
      </section>

      <section id="create" className="scroll-mt-20 border-t border-line bg-bg-soft/60 py-12">
        <div className="container-page">
          <h2 className="mb-5 font-display text-3xl">{c.generator.title}</h2>
          <Generator />
        </div>
      </section>

      {/* Problem：不用本站时的麻烦，文案设为 null 就不渲染 */}
      {c.problem ? (
        <section id="problem" className="scroll-mt-20 border-t border-line py-20">
          <div className="container-page">
            <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight sm:text-5xl">{c.problem.title}</h2>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {c.problem.items.map((item) => (
                <div key={item.title} className="card p-6">
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 leading-7 text-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* With / Without：自己做和用本站逐行对比，文案设为 null 就不渲染 */}
      {c.withWithout ? (
        <section id="compare" className="scroll-mt-20 border-t border-line bg-bg-soft/60 py-20">
          <div className="container-page max-w-4xl">
            <h2 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{c.withWithout.title}</h2>
            <table className="mt-10 w-full table-fixed overflow-hidden rounded-2xl bg-card text-left ring-1 ring-line">
              <thead>
                <tr className="border-b border-line text-sm">
                  <th scope="col" className="p-4 font-semibold text-muted">
                    {c.withWithout.without}
                  </th>
                  <th scope="col" className="p-4 font-semibold">
                    {c.withWithout.with}
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.withWithout.rows.map((row) => (
                  <tr key={row.with} className="border-b border-line last:border-0">
                    <td className="p-4 align-top text-muted">
                      <span className="flex items-start gap-2">
                        <X className="mt-1 size-4 shrink-0 text-rose-500" aria-hidden /> {row.without}
                      </span>
                    </td>
                    <td className="p-4 align-top">
                      <span className="flex items-start gap-2">
                        <Check className="mt-1 size-4 shrink-0 text-emerald-600" aria-hidden /> {row.with}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* How to：三步流程（关键词 H2；HowTo 富结果已下线，只用语义化有序列表） */}
      <section id="how-it-works" className="scroll-mt-20 border-t border-line py-20">
        <div className="container-page">
          <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight sm:text-5xl">{c.howTo.title}</h2>
          <ol className="mt-12 grid gap-5 md:grid-cols-3">
            {c.howTo.steps.map((step, index) => (
              <li key={step.title} className="card p-6">
                <span className="font-display text-4xl text-accent">{index + 1}</span>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 leading-7 text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm font-semibold">
            <a href="#create" className="btn-primary">
              {c.howTo.cta}
            </a>
            <LocalLink to={articlePath('howTo')} className="inline-flex items-center gap-1.5 hover:text-accent">
              {c.howTo.guide} <ArrowRight className="size-4" />
            </LocalLink>
          </div>
        </div>
      </section>

      {/* 示例统一展示为视频网格。 */}
      <section id="examples" className="scroll-mt-20 border-t border-line bg-bg-soft/60 py-20">
        <div className="container-page">
          <div className="space-y-4">
            <h2 className="font-display text-4xl leading-tight sm:text-5xl">{c.madeWith.title}</h2>
          </div>
          <div className={`mt-12 grid gap-6 ${portraitExamples ? exampleVideos.length === 1 ? 'mx-auto w-full max-w-sm' : 'mx-auto w-full max-w-3xl sm:grid-cols-2' : 'sm:grid-cols-2'}`}>
            {exampleVideos.map((example) => (
              <VideoCard
                key={example.video}
                video={example.video}
                poster={example.poster}
                aspectRatio={exampleAspectRatio}
                fit="contain"
              />
            ))}
          </div>
        </div>
      </section>

      {/* What is：解释趋势本身，承接 "what is {keyword}" 信息型搜索 */}
      <section id="about" className="scroll-mt-20 py-20">
        <div className="container-page max-w-3xl">
          <h2 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{c.whatIs.title}</h2>
          {c.whatIs.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-5 text-lg leading-8 text-muted">
              {paragraph}
            </p>
          ))}
          <LocalLink to={articlePath('trend')} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold hover:text-accent">
            {c.whatIs.guide} <ArrowRight className="size-4" />
          </LocalLink>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 border-t border-line py-20">
        <div className="container-page">
          <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight sm:text-5xl">{c.features.title}</h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {c.features.items.map((item, index) => {
              const Icon = FEATURE_ICONS[index % FEATURE_ICONS.length]!
              return (
                <div key={item.title} className="card p-6">
                  <span className="grid size-10 place-items-center rounded-xl bg-bg-soft">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 leading-7 text-muted">{item.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Ideas：左右交替 */}
      <section className="border-t border-line py-20">
        <div className="container-page">
          <h2 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{c.ideas.title}</h2>
          <div className="mt-14 space-y-20">
            {c.ideas.items.map((idea, index) => {
              const media = ex.ideas[index % ex.ideas.length]!
              const flip = index % 2 === 1
              return (
                <div key={idea.title} className="grid items-center gap-10 md:grid-cols-2">
                  <div className={`grid grid-cols-[0.8fr_1fr] items-end gap-4 ${flip ? 'md:order-2' : ''}`}>
                    <img src={media.photo} alt={c.alt.inputPhoto} loading="lazy" className="aspect-[3/4] w-full rounded-2xl object-cover ring-1 ring-line" />
                    <VideoCard video={media.video} poster={media.poster} />
                  </div>
                  <div className="space-y-4">
                    <h3 className="font-display text-3xl">{idea.title}</h3>
                    <p className="max-w-md text-lg leading-8 text-muted">{idea.body}</p>
                    <a href="#create" className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-accent">
                      {c.ideas.cta} <ArrowRight className="size-4" />
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-t border-line bg-bg-soft/60 py-20">
        <div className="container-page">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="mt-3 font-display text-4xl sm:text-5xl">{c.pricing.title}</h2>
            <p className="mt-4 text-muted">{c.pricing.subtitle}</p>
          </div>
          <Pricing />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 py-20">
        <div className="container-page">
          <Faq />
        </div>
      </section>

      {/* Final CTA */}
      <section className="pb-24">
        <div className="container-page">
          <div className="relative overflow-hidden rounded-3xl bg-ink px-6 py-16 text-center text-ink-fg sm:px-12">
            <div
              className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(50%_60%_at_20%_0%,var(--accent),transparent_70%),radial-gradient(40%_50%_at_90%_100%,var(--accent-2),transparent_70%)]"
              aria-hidden
            />
            <div className="relative space-y-5">
              <h2 className="font-display text-4xl leading-tight sm:text-5xl">{c.finalCta.title}</h2>
              <a href="#create" className="btn mt-2 bg-ink-fg text-ink hover:opacity-90">
                {c.finalCta.cta} <ArrowRight className="size-4" />
              </a>
              <div className="mx-auto max-w-3xl space-y-2 text-sm text-ink-fg/75">
                <p>{c.pricing.subtitle}</p>
                <p className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                  {site.packages.map((pack) => (
                    <span key={pack.id}>
                      {c.pricing.credits(pack.credits)} · {formatPrice(pack.priceCents, pack.currency)}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function youtubeEmbedUrl(youtube: { videoId: string; playlistId?: string; startAt?: number }) {
  const params = new URLSearchParams()
  if (youtube.startAt) params.set('start', String(youtube.startAt))
  if (youtube.playlistId) params.set('list', youtube.playlistId)
  const query = params.toString()
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtube.videoId)}${query ? `?${query}` : ''}`
}
