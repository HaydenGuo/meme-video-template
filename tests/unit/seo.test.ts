import { describe, expect, it } from 'vitest'
import { aggregateOffer } from '#/lib/seo'

describe('aggregateOffer', () => {
  it('omits offers when there are no packages', () => {
    expect(aggregateOffer([])).toBeUndefined()
  })

  it('summarizes prices for packages in one currency', () => {
    expect(aggregateOffer([
      { priceCents: 990, currency: 'USD' },
      { priceCents: 2990, currency: 'USD' },
    ])).toEqual({
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: '9.90',
      highPrice: '29.90',
      offerCount: 2,
    })
  })

  it('omits a combined offer when packages use different currencies', () => {
    expect(aggregateOffer([
      { priceCents: 990, currency: 'USD' },
      { priceCents: 900, currency: 'EUR' },
    ])).toBeUndefined()
  })
})
