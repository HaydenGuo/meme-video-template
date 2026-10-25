import { Hono } from 'hono'
import { ARTICLES, DEFAULT_LOCALE, LOCALES, localePath, site } from '#/config/site'
import { absoluteUrl, loadContent } from '#/lib/i18n'
import type { AppContext } from './types'
import { isIndexable } from './util'

export const seoRoutes = new Hono<AppContext>()

// IndexNow 验证文件：site.seo.indexNowKey 非空时在 /<key>.txt 返回 key 本身（npm run seo:indexnow 用它提交 URL）
const INDEXNOW_PATH = site.seo.indexNowKey ? `/${site.seo.indexNowKey}.txt` : null
const FEED_PATHS = LOCALES.map((locale) => localePath(locale, '/feed.xml'))

// server.ts 用它决定交给 Hono 还是 TanStack
export function isSeoPath(pathname: string) {
  return ['/sitemap.xml', '/sitemap-index.xml', '/sitemap-0.xml', '/robots.txt'].includes(pathname) || pathname === INDEXNOW_PATH || FEED_PATHS.includes(pathname)
}

const ARTICLE_PATHS = ARTICLES.map((article) => `/${article.slug}`)

// 可被索引的公开页面（账户、结账、后台页都带 noindex，不进 sitemap）
export const PUBLIC_PATHS = ['/', '/pricing', '/guides', '/contact', '/report', '/privacy-policy', '/terms-of-service', '/refund-policy', '/acceptable-use-policy', ...ARTICLE_PATHS]

// lastmod 按页面取：文章用各自的 updatedAt，/guides 随最新文章变化，其余页面用 site.seo.updatedAt
function lastModified(path: string) {
  const article = ARTICLES.find((a) => `/${a.slug}` === path)
  if (article) return article.updatedAt
  if (path === '/guides') return [site.seo.updatedAt, ...ARTICLES.map((a) => a.updatedAt)].sort().at(-1)!
  return site.seo.updatedAt
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 指南与页面共用文案和日期，不依赖请求时间，也不包含用户视频或账户数据。
for (const locale of LOCALES) {
  seoRoutes.get(localePath(locale, '/feed.xml'), async (c) => {
    const content = await loadContent(locale)
    const feedUrl = absoluteUrl(localePath(locale, '/feed.xml'))
    const items = [...ARTICLES].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((article) => {
      const text = content.articles[article.key]
      const url = escapeXml(absoluteUrl(localePath(locale, `/${article.slug}`)))
      return `<item><title>${escapeXml(text.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><description>${escapeXml(text.description)}</description><pubDate>${new Date(`${article.publishedAt}T00:00:00Z`).toUTCString()}</pubDate></item>`
    })
    const lastBuildDate = new Date(`${lastModified('/guides')}T00:00:00Z`).toUTCString()
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escapeXml(content.guides.title)}</title><link>${escapeXml(absoluteUrl(localePath(locale, '/guides')))}</link><description>${escapeXml(content.guides.description)}</description><language>${locale}</language><lastBuildDate>${lastBuildDate}</lastBuildDate><atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>${items.join('\n')}</channel></rss>`
    return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
  })
}

const SITEMAP_HEADERS = { 'Content-Type': 'application/xml', 'Cache-Control': 'public, must-revalidate, max-age=0' }
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'

// 与游戏站一致：索引文件指向 urlset 子地图；日期来自内容，而非抓取时间。
seoRoutes.get('/sitemap-index.xml', (c) => {
  const updatedAt = new Date(`${lastModified('/guides')}T00:00:00Z`).toISOString()
  return c.body(`${XML_DECLARATION}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${escapeXml(absoluteUrl('/sitemap-0.xml'))}</loc><lastmod>${updatedAt}</lastmod></sitemap></sitemapindex>`, 200, SITEMAP_HEADERS)
})

// 旧地址仍返回同一子地图，兼容已有订阅和搜索引擎记录。
// 页面 URL 沿用实际 canonical，不额外引入会重定向的尾斜杠。
seoRoutes.on('GET', ['/sitemap-0.xml', '/sitemap.xml'], (c) => {
  const urls = PUBLIC_PATHS.flatMap((path) =>
    LOCALES.map((locale) => {
      const alternates = [
        ...LOCALES.map((alt) => `<xhtml:link rel="alternate" hreflang="${alt}" href="${escapeXml(absoluteUrl(localePath(alt, path)))}"/>`),
        `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(absoluteUrl(localePath(DEFAULT_LOCALE, path)))}"/>`,
      ].join('')
      const contentPage = path === '/guides' || ARTICLE_PATHS.includes(path)
      const lastmod = contentPage ? `<lastmod>${new Date(`${lastModified(path)}T00:00:00Z`).toISOString()}</lastmod>` : ''
      return `<url><loc>${escapeXml(absoluteUrl(localePath(locale, path)))}</loc>${lastmod}${alternates}</url>`
    }),
  )
  const xml = `${XML_DECLARATION}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${urls.join('')}</urlset>`
  return c.body(xml, 200, SITEMAP_HEADERS)
})

if (INDEXNOW_PATH) {
  seoRoutes.get(INDEXNOW_PATH, (c) => c.text(site.seo.indexNowKey, 200, { 'Cache-Control': 'public, max-age=86400' }))
}

// 只有正式站（APP_ENV=production）允许抓取；staging 和本地整体禁止，避免与正式站重复收录
seoRoutes.get('/robots.txt', (c) => {
  const body = isIndexable(c.env)
    ? [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin',
        ...LOCALES.map((locale) => `Disallow: ${localePath(locale, '/checkout/')}`),
        '',
        `Sitemap: ${absoluteUrl('/sitemap-index.xml')}`,
      ].join('\n')
    : ['User-agent: *', 'Disallow: /'].join('\n')
  return c.text(`${body}\n`, 200, { 'Cache-Control': 'public, max-age=3600' })
})
