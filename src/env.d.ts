// 可选 secret：没写进 .dev.vars 时 `npm run cf:types` 不会生成它们，这里补上类型
interface Env {
  PROMPT_SCAN_PROVIDER?: string
  SHOWCASE_MODE?: string
  AUTH_ENABLED?: string
  GENERATION_ENABLED?: string
  PAYMENTS_ENABLED?: string
  SHOWCASE_AUTH_ENABLED?: string
  OWNER_INITIAL_CREDIT_EMAIL_HASH?: string
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
