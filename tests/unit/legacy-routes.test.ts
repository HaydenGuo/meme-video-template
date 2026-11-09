import { describe, expect, it } from 'vitest'
import { legacyTemplateRoute } from '#/server/legacy-routes'

const publicPaths = ['/', '/pricing', '/privacy-policy', '/guides']

describe('legacy template URLs', () => {
  it.each([
    ['/{-$locale}', '/'],
    ['/{-$locale}/', '/'],
    ['/{-$locale}/pricing', '/pricing'],
    ['/%7B-%24locale%7D/privacy-policy/', '/privacy-policy'],
  ])('redirects %s to its actual public page', (path, target) => {
    expect(legacyTemplateRoute(path, publicPaths)).toEqual({ status: 301, path: target })
  })

  it.each(['/{-$locale}/$slug', '/{-$locale}/undefined', '/{-$locale}/unknown', '/{-$locale}/%2Fother-host.test'])('retires unmapped placeholders %s', (path) => {
    expect(legacyTemplateRoute(path, publicPaths)).toEqual({ status: 410, path: null })
  })

  it.each(['/pricing', '/zh/pricing', '/api/me', '/%E0%A4%A'])('leaves ordinary and malformed paths %s to the normal handler', (path) => {
    expect(legacyTemplateRoute(path, publicPaths)).toBeNull()
  })
})
