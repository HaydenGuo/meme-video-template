import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '#/components/LegalPage'
import { site } from '#/config/site'
import { getContent, localeFromParam, pageHead } from '#/lib/i18n'

export const Route = createFileRoute('/{-$locale}/acceptable-use-policy')({
  head: ({ params }) => {
    const locale = localeFromParam(params.locale)
    const doc = getContent(locale).legal.aup
    return pageHead(locale, '/acceptable-use-policy', `${doc.title} – ${site.brandName}`, doc.sections[0]!.p[0]!)
  },
  component: () => <LegalPage doc={(c) => c.legal.aup} />,
})
