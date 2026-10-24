import { expect, test } from '@playwright/test'
import { site } from '#/config/site'
import { ORIGIN, buyPackage, content, credits, devLogin, json, ledger, post, uniqueEmail, uploadPhoto } from './helpers'

type Generation = { id: string; status: string }
type Grant = { source: string; amount: number; remaining: number; expires_at: string | null }

const ADMIN_EMAIL = 'admin@example.com'

// 积分批次：补发可设有效期，扣费先扣快到期的，生成失败按明细原路退回，到期由 Cron 作废并写 expire 流水
test('积分批次：先扣快到期的补发积分，失败原路退回，到期作废并在账单页提示', async ({ page, playwright }) => {
  const userEmail = uniqueEmail('grants')
  const user = await playwright.request.newContext({ baseURL: ORIGIN })
  try {
    const { id: userId } = await devLogin(user, userEmail)
    await buyPackage(user, 'starter') // 25 积分，永不过期

    await devLogin(page.request, ADMIN_EMAIL)
    page.on('dialog', (dialog) => dialog.accept())
    const grants = async () => (await json<{ grants: Grant[] }>(page.request.get(`/api/admin/users/${userId}`))).grants

    // 扣减不能设有效期
    const bad = await json<{ error: string }>(post(page.request, `/api/admin/users/${userId}/credits`, { delta: -1, note: 'x', expiresInDays: 1 }), 400)
    expect(bad.error).toBe('invalid_expiry')

    await page.goto(`/admin/users/${userId}`)
    await page.getByTestId('admin-delta').fill('4')
    await page.getByTestId('admin-expiry-days').fill('1')
    await page.getByTestId('admin-note').fill('e2e 限时补偿')
    await page.getByTestId('admin-adjust').click()
    await expect(page.getByTestId('admin-user-credits')).toHaveText('29')
    const table = page.getByTestId('admin-user-grants')
    await expect(table.locator('tbody tr')).toHaveCount(2)
    await expect(table.locator('tbody tr').first()).toContainText('admin_adjust')
    await expect(table.locator('tbody tr').first()).toContainText('4 / 4')
    await expect(table.locator('tbody tr').last()).toContainText('永不过期')

    // 生成 5 积分：先扣到期的 4，再扣购买的 1；失败后原路退回
    const { upload } = await json<{ upload: { id: string } }>(uploadPhoto(user), 201)
    const { generation } = await json<{ generation: Generation }>(
      post(user, '/api/generations', { uploadId: upload.id, durationId: 'short', mockOutcome: 'fail' }),
      201,
    )
    expect(await credits(user)).toBe(24)
    expect((await grants()).map((g) => [g.source, g.remaining])).toEqual([['purchase', 24]])
    await expect
      .poll(async () => (await json<{ generation: Generation }>(user.get(`/api/generations/${generation.id}`))).generation.status, {
        timeout: 60_000,
        intervals: [1000],
      })
      .toBe('failed')
    expect(await credits(user)).toBe(29)
    expect((await grants()).map((g) => [g.source, g.remaining, g.amount])).toEqual([
      ['admin_adjust', 4, 4],
      ['purchase', 25, 25],
    ])

    // 账单页提示即将到期的积分
    const expiring = await json<{ expiring: Array<{ credits: number; expiresAt: string }> }>(user.get('/api/credits/expiring'))
    expect(expiring.expiring).toEqual([{ credits: 4, expiresAt: expect.any(String) }])
    await devLogin(page.request, userEmail)
    await page.goto('/dashboard/billing')
    await expect(page.getByTestId('credits-expiring')).toContainText('4 credits expire on')
    await expect(page.getByTestId('credits-expiring')).toContainText(content.en.billing.expiringHint)

    // 两天后作废：余额回到 25，expire 流水只写一次
    expect(await json(post(user, '/api/dev/expire-credits', { days: 2 }))).toEqual({ credits: 25 })
    expect(await json(post(user, '/api/dev/expire-credits', { days: 2 }))).toEqual({ credits: 25 })
    expect(await credits(user)).toBe(25)
    const entries = await ledger(user)
    expect(entries.filter((e) => e.reason === 'expire').map((e) => e.delta)).toEqual([-4])
    expect(entries.reduce((sum, e) => sum + e.delta, 0)).toBe(25)
    expect((await json<{ expiring: unknown[] }>(user.get('/api/credits/expiring'))).expiring).toEqual([])
    await page.reload()
    await expect(page.getByTestId('ledger-table')).toContainText(content.en.billing.reasons.expire!)
    await expect(page.getByTestId('credits-expiring')).toHaveCount(0)
  } finally {
    await user.dispose()
  }
})

test('并发扣费：余额只够一次时同时发起两个生成，一个成功一个 402，余额不为负', async ({ request, playwright }) => {
  const fullCost = site.durations.find((duration) => duration.id === 'full')!.credits
  const initialBalance = fullCost * 2 - 1
  const { id: userId } = await devLogin(request, uniqueEmail('race'))
  await buyPackage(request, 'starter') // 25
  const admin = await playwright.request.newContext({ baseURL: ORIGIN })
  try {
    await devLogin(admin, ADMIN_EMAIL)
    await json(post(admin, `/api/admin/users/${userId}/credits`, { delta: initialBalance - 25, note: 'e2e 限时', expiresInDays: 1 }))
  } finally {
    await admin.dispose()
  }
  expect(await credits(request)).toBe(initialBalance)

  const { upload } = await json<{ upload: { id: string } }>(uploadPhoto(request), 201)
  const body = { uploadId: upload.id, durationId: 'full', mockOutcome: 'hang' }
  const results = await Promise.all([post(request, '/api/generations', body), post(request, '/api/generations', body)])
  expect(results.map((r) => r.status()).sort()).toEqual([201, 402])
  expect(await credits(request)).toBe(initialBalance - fullCost)
  const entries = await ledger(request)
  expect(entries.filter((e) => e.reason === 'generation').map((e) => e.delta)).toEqual([-fullCost])
  expect(entries.reduce((sum, e) => sum + e.delta, 0)).toBe(initialBalance - fullCost)
})
