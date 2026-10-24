import type { Content } from '#/content/en'
import { useContent } from '#/lib/i18n'
import { site } from '#/config/site'
import { LocalLink } from './ui'

type Doc = Content['legal']['privacy']

export function LegalPage({ doc }: { doc: (c: Content) => Doc }) {
  const c = useContent()
  const page = doc(c)
  return (
    <article className="container-page max-w-3xl py-16">
      <h1 className="font-display text-5xl">{page.title}</h1>
      <p className="mt-3 text-sm text-muted">
        {c.common.lastUpdated}: {c.legal.updated}
      </p>
      <div className="prose-article mt-8">
        {page.sections.map((section) => (
          <section key={section.h}>
            <h2>{section.h}</h2>
            {section.p.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </section>
        ))}
      </div>
      <nav className="mt-10 flex flex-wrap gap-x-5 gap-y-3 border-t border-line pt-6 text-sm">
        <LocalLink to="/terms-of-service" className="underline">{c.footer.terms}</LocalLink>
        <LocalLink to="/privacy-policy" className="underline">{c.footer.privacy}</LocalLink>
        <LocalLink to="/refund-policy" className="underline">{c.footer.refund}</LocalLink>
        <LocalLink to="/acceptable-use-policy" className="underline">{c.footer.aup}</LocalLink>
        <LocalLink to="/report" className="underline">{c.footer.report}</LocalLink>
        <a href={`mailto:${site.supportEmail}`} className="underline">{site.supportEmail}</a>
      </nav>
    </article>
  )
}
