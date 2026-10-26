import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ processPaymentEvent: vi.fn(), getOrderProvider: vi.fn() }))
vi.mock('../../src/server/orders', () => ({ processPaymentEvent: mocks.processPaymentEvent }))
vi.mock('../../src/server/payments', () => ({ getOrderProvider: mocks.getOrderProvider }))

import { processVerifiedPaymentWebhook } from '../../src/server/reconcile'
import type { PaidEvent } from '../../src/server/payments/types'

const order = {
  id: 'ord_confirmed',
  user_id: 'user_1',
  provider: 'dodo',
  package_id: 'starter',
  provider_session_id: 'session_1',
} as never

const paid = (amount: number, eventId: string): PaidEvent => ({
  kind: 'paid',
  eventId,
  eventType: 'payment.succeeded',
  orderId: 'ord_confirmed',
  providerOrderId: null,
  providerPaymentId: 'pay_1',
  paidAmount: String(amount / 100),
  paidCurrency: 'USD',
  paidAmountCents: amount,
})

function envWithOrder() {
  const first = vi.fn().mockResolvedValue(order)
  const bind = vi.fn(() => ({ first }))
  const prepare = vi.fn(() => ({ bind }))
  return { env: { DB: { prepare } } as unknown as Env, prepare, bind, first }
}

describe('verified payment webhook confirmation', () => {
  beforeEach(() => vi.resetAllMocks())

  it('uses the provider lookup event instead of the callback amount', async () => {
    const { env } = envWithOrder()
    const callback = paid(1, 'webhook_evt')
    const confirmed = paid(990, 'reconcile:pay_1')
    const fetchPaidEvent = vi.fn().mockResolvedValue({ event: confirmed, raw: { status: 'succeeded', amount: '9.90' } })
    mocks.getOrderProvider.mockReturnValue({ id: 'dodo', fetchPaidEvent })
    mocks.processPaymentEvent.mockResolvedValue({ status: 'processed', orderId: 'ord_confirmed' })

    await expect(processVerifiedPaymentWebhook(env, 'dodo', callback, '{"callback":true}')).resolves.toMatchObject({ status: 'processed' })
    expect(fetchPaidEvent).toHaveBeenCalledWith({ id: 'ord_confirmed', packageId: 'starter', providerSessionId: 'session_1' })
    expect(mocks.processPaymentEvent).toHaveBeenCalledWith(
      env,
      'dodo',
      confirmed,
      JSON.stringify({ source: 'webhook_lookup', payment: { status: 'succeeded', amount: '9.90' } }),
    )
  })

  it('returns an error for webhook retry when the provider has not confirmed the order', async () => {
    const { env } = envWithOrder()
    const fetchPaidEvent = vi.fn().mockResolvedValue(null)
    mocks.getOrderProvider.mockReturnValue({ id: 'dodo', fetchPaidEvent })

    await expect(processVerifiedPaymentWebhook(env, 'dodo', paid(990, 'webhook_evt'), '{}')).rejects.toMatchObject({
      status: 503,
      code: 'payment_provider_error',
    })
    expect(mocks.processPaymentEvent).not.toHaveBeenCalled()
  })
})
