// 可选 secret：没写进 .dev.vars 时 `npm run cf:types` 不会生成它们，这里补上类型
interface Env {
  SHOWCASE_MODE?: string
  SHOWCASE_AUTH_ENABLED?: string
  SESSION_SECRET?: string
  GOOGLE_CLIENT_SECRET?: string
  WAFFO_MERCHANT_ID?: string
  WAFFO_PRIVATE_KEY?: string
  DODO_API_KEY?: string
  DODO_WEBHOOK_SECRET?: string
  FAL_KEY?: string
  HYPIT_BRIDGE_TOKEN?: string
  TURNSTILE_SECRET_KEY?: string
  OPENAI_API_KEY?: string
  YIR_API_KEY?: string
  PAYMENT_NOTIFY_WEBHOOK_URL?: string
}
