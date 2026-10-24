// 可选 secret：没写进 .dev.vars 时 `npm run cf:types` 不会生成它们，这里补上类型
interface Env {
  SHOWCASE_MODE?: string
  HYPIT_BRIDGE_TOKEN?: string
  TURNSTILE_SECRET_KEY?: string
  OPENAI_API_KEY?: string
  YIR_API_KEY?: string
  PAYMENT_NOTIFY_WEBHOOK_URL?: string
}
