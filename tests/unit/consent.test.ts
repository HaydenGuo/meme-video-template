import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_KEY, ga4BootstrapScript, saveConsent } from '#/lib/consent'

const GA4_ID = 'G-TEST123'

// 最小浏览器环境：记录 dataLayer、追加到 <head> 的脚本和每次写 document.cookie 的内容
function browser(stored: string | null | 'throws', href = 'https://example.test/checkout/result?email=buyer%40example.test&status=paid') {
  const appended: Array<{ src: string }> = []
  const cookieWrites: string[] = []
  let cookie = ''
  const document = {
    createElement: () => ({ async: false, src: '' }),
    head: { appendChild: (el: { src: string }) => appended.push(el) },
    querySelector: (selector: string) => appended.find((el) => selector.includes(el.src.split('?')[0]!)) ?? null,
    get cookie() {
      return cookie
    },
    set cookie(value: string) {
      cookieWrites.push(value)
    },
  }
  const localStorage = {
    getItem: () => {
      if (stored === 'throws') throw new Error('SecurityError')
      return stored
    },
    setItem: vi.fn(),
  }
  const window = { dataLayer: undefined as unknown[] | undefined, gtag: undefined as unknown }
  const context = { window, document, localStorage, location: new URL(href), URL, Date }
  return {
    context,
    appended,
    cookieWrites,
    setCookie: (value: string) => (cookie = value),
    run(script: string) {
      // 内联脚本在全局作用域执行：window 即全局对象
      const global = Object.assign(context.window, context)
      runInNewContext(script, global)
      return global as typeof global & { dataLayer: IArguments[] }
    },
  }
}

const calls = (dataLayer: IArguments[]) => dataLayer.map((args) => Array.from(args))

describe('ga4BootstrapScript', () => {
  it('未接受：默认拒绝且不排队 GA4 config 或 page_view', () => {
    const env = browser(null)
    const global = env.run(ga4BootstrapScript(GA4_ID))
    const queued = calls(global.dataLayer)
    const [consent] = queued
    expect(consent).toEqual([
      'consent',
      'default',
      { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' },
    ])
    expect(queued.find(([command]) => command === 'config')).toBeUndefined()
    expect(env.appended).toEqual([])
  })

  it('已同意的回访者：analytics_storage granted 并加载 gtag.js；广告项仍 denied', () => {
    const env = browser('granted')
    const global = env.run(ga4BootstrapScript(GA4_ID))
    expect(calls(global.dataLayer)[0]![2]).toMatchObject({ analytics_storage: 'granted', ad_storage: 'denied' })
    expect(env.appended.map((s) => s.src)).toEqual([`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`])
  })

  it('拒绝过或禁用存储：不加载', () => {
    for (const stored of ['denied', 'throws'] as const) {
      const env = browser(stored)
      const global = env.run(ga4BootstrapScript(GA4_ID))
      expect(calls(global.dataLayer)[0]![2]).toMatchObject({ analytics_storage: 'denied' })
      expect(env.appended).toEqual([])
    }
  })
})

describe('saveConsent', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stub(href: string) {
    const env = browser(null, href)
    env.run(ga4BootstrapScript(GA4_ID))
    for (const [key, value] of Object.entries(env.context)) vi.stubGlobal(key, value)
    return env
  }

  it('接受：记住选择、更新同意状态并只加载一次 gtag.js', () => {
    const env = stub('https://www.example.test/checkout/result?email=buyer%40example.test&analytics=on&preview=1&status=paid')
    saveConsent(GA4_ID, 'granted')
    saveConsent(GA4_ID, 'granted')
    expect((env.context.window as { [key: string]: unknown })['ga-disable-' + GA4_ID]).toBe(false)
    expect(env.context.localStorage.setItem).toHaveBeenCalledWith(CONSENT_KEY, 'granted')
    const queued = calls(env.context.window.dataLayer as IArguments[])
    const consentIndex = queued.findIndex(([command, action]) => command === 'consent' && action === 'update')
    const configIndex = queued.findIndex(([command]) => command === 'config')
    expect(consentIndex).toBeGreaterThan(-1)
    expect(configIndex).toBeGreaterThan(consentIndex)
    expect(queued[configIndex]).toEqual(['config', GA4_ID, { page_location: 'https://www.example.test/checkout/result?status=paid' }])
    expect(env.appended).toHaveLength(1)
  })

  it('撤回：更新为 denied，并在当前主机和各级父域上删除 _ga 系列 Cookie，不动其他 Cookie', () => {
    const env = stub('https://www.example.test/')
    env.setCookie('_ga=GA1.1.1; _ga_TEST123=GS1.1; vt_attr=abc; session=xyz')
    saveConsent(GA4_ID, 'granted')
    expect(env.appended).toHaveLength(1)
    saveConsent(GA4_ID, 'denied')
    expect((env.context.window as { [key: string]: unknown })['ga-disable-' + GA4_ID]).toBe(true)
    expect(calls(env.context.window.dataLayer as IArguments[]).at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    expect(env.cookieWrites.sort()).toEqual(
      [
        '_ga=; Max-Age=0; Path=/',
        '_ga=; Max-Age=0; Path=/; Domain=.www.example.test',
        '_ga=; Max-Age=0; Path=/; Domain=.example.test',
        '_ga_TEST123=; Max-Age=0; Path=/',
        '_ga_TEST123=; Max-Age=0; Path=/; Domain=.www.example.test',
        '_ga_TEST123=; Max-Age=0; Path=/; Domain=.example.test',
      ].sort(),
    )
    saveConsent(GA4_ID, 'granted')
    expect((env.context.window as { [key: string]: unknown })['ga-disable-' + GA4_ID]).toBe(false)
    expect(env.appended).toHaveLength(1)
  })
})
