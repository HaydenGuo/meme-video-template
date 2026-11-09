// 历史误泄露的 TanStack 可选语言占位路径只映射到确有对应内容的公开页面。
export function legacyTemplateRoute(pathname: string, publicPaths: readonly string[]) {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const match = decoded.match(/^\/\{-\$locale\}(?:\/(.*))?$/)
  if (!match) return null
  const path = `/${match[1] ?? ''}`.replace(/\/+$/, '') || '/'
  return publicPaths.includes(path)
    ? { status: 301 as const, path }
    : { status: 410 as const, path: null }
}
