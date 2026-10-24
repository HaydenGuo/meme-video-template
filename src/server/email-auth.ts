import { emailConfig } from './email'
import { isWeakSessionSecret } from './config-health'
import { renderEmail } from './email-templates'
import { ApiError, base64Url, base64UrlDecode, constantTimeEqual, createId, hmacSha256, nowIso } from './util'

const ITERATIONS = 100_000
const CODE_MINUTES = 10
type Purpose = 'register' | 'reset'

export function emailPasswordEnabled(env: Env) {
  const secret = env.SESSION_SECRET?.trim()
  return !!secret && !isWeakSessionSecret(secret)
}

export function emailVerificationEnabled(env: Env, local: boolean) {
  const mail = emailConfig(env)
  return emailPasswordEnabled(env) && (local || !!(mail && !/@(?:[^@]*\.)?example\.(com|org|net)$/i.test(mail.from.email)))
}

export function normalizeAuthEmail(value: unknown) {
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_email')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || /[\u0000-\u001f\u007f]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'invalid_email')
  return email
}

export function authPurpose(value: unknown): Purpose {
  if (value !== 'register' && value !== 'reset') throw new ApiError(400, 'invalid_auth_request')
  return value
}

export function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw new ApiError(400, 'invalid_password')
}

function authSecret(env: Env) {
  const secret = env.SESSION_SECRET?.trim()
  if (!secret || !emailPasswordEnabled(env)) throw new ApiError(503, 'email_auth_not_configured')
  return secret
}

// Workers 单次 PBKDF2 上限为 100000。先用独立域的服务端 pepper 做 HMAC，再用随机盐派生；版本参数写入哈希。
async function derivePassword(env: Env, password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await hmacSha256(authSecret(env), `password:v1:${password}`)
  const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits'])
  return base64Url(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt, iterations: ITERATIONS }, key, 256)))
}

export async function hashPassword(env: Env, password: string) {
  validatePassword(password)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `v1$pbkdf2-sha512$${ITERATIONS}$${base64Url(salt)}$${await derivePassword(env, password, salt)}`
}

export async function verifyPassword(env: Env, password: string, encoded: string | null) {
  const parts = encoded?.split('$')
  const validFormat = parts?.length === 5 && parts[0] === 'v1' && parts[1] === 'pbkdf2-sha512' && parts[2] === String(ITERATIONS)
  // 不存在的邮箱也执行同等 KDF，避免靠响应时间轻易枚举账户。
  const salt = validFormat ? base64UrlDecode(parts[3]!) : new Uint8Array(16)
  const computed = await derivePassword(env, password, salt)
  return !!validFormat && constantTimeEqual(computed, parts[4]!)
}

export async function limitEmailAction(env: Env, scope: string, maximum: number, windowMs: number) {
  const now = nowIso()
  const cutoff = new Date(Date.now() - windowMs).toISOString()
  const result = await env.DB.prepare(
    `INSERT INTO email_auth_limits (scope, attempts, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(scope) DO UPDATE SET
       attempts = CASE WHEN window_start <= ?3 THEN 1 ELSE attempts + 1 END,
       window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
     WHERE window_start <= ?3 OR attempts < ?4`,
  ).bind(scope, now, cutoff, maximum).run()
  if (!result.meta.changes) throw new ApiError(429, 'rate_limited')
}

export async function sendAuthCode(env: Env, email: string, purpose: Purpose, locale: string | undefined, local: boolean) {
  authSecret(env)
  const mail = emailConfig(env)
  if (!emailVerificationEnabled(env, local)) throw new ApiError(503, 'email_auth_not_configured')
  await limitEmailAction(env, `send:${email}`, 5, 3600_000)
  const id = createId('eac')
  // 拒绝采样避免六位数字的取模偏差。
  let random: number
  do { random = crypto.getRandomValues(new Uint32Array(1))[0]! } while (random >= 4_294_000_000)
  const code = String(random % 1_000_000).padStart(6, '0')
  const codeHash = base64Url(await hmacSha256(authSecret(env), `email-code:${id}:${code}`))
  const now = nowIso()
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString()
  const result = await env.DB.prepare(
    `INSERT INTO email_auth_challenges (id, email, purpose, code_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(email, purpose) DO UPDATE SET id = ?1, code_hash = ?4, attempts = 0, created_at = ?5, expires_at = ?6, used_at = NULL
     WHERE email_auth_challenges.created_at <= ?7`,
  ).bind(id, email, purpose, codeHash, now, expiresAt, new Date(Date.now() - 60_000).toISOString()).run()
  if (!result.meta.changes) throw new ApiError(429, 'rate_limited')
  if (!local) {
    const rendered = renderEmail('auth_code', { code, purpose, minutes: CODE_MINUTES }, { siteUrl: env.SITE_URL, locale: locale ?? null })
    try {
      // 验证码邮件直接发送，避免把明文验证码放入后台可见的发件箱或延迟重试队列。
      await mail!.mailer.send({ from: mail!.from, to: email, ...rendered })
    } catch {
      await env.DB.prepare('DELETE FROM email_auth_challenges WHERE id = ?').bind(id).run()
      throw new ApiError(503, 'email_delivery_failed')
    }
  }
  return { challengeId: id, expiresAt, ...(local ? { developmentCode: code } : {}) }
}

// 原子增加尝试次数，再原子领取一次性挑战，防止并发重放；不回传验证码是否接近正确。
export async function consumeAuthCode(env: Env, email: string, purpose: Purpose, id: unknown, code: unknown) {
  if (typeof id !== 'string' || id.length > 100 || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new ApiError(400, 'invalid_verification_code')
  const now = nowIso()
  const challenge = await env.DB.prepare(
    `UPDATE email_auth_challenges SET attempts = attempts + 1
     WHERE id = ? AND email = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? AND attempts < 5
     RETURNING code_hash`,
  ).bind(id, email, purpose, now).first<{ code_hash: string }>()
  const actual = base64Url(await hmacSha256(authSecret(env), `email-code:${id}:${code}`))
  if (!challenge || !constantTimeEqual(challenge.code_hash, actual)) throw new ApiError(400, 'invalid_verification_code')
  const claimed = await env.DB.prepare(
    'UPDATE email_auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING id',
  ).bind(now, id, now).first<{ id: string }>()
  if (!claimed) throw new ApiError(400, 'invalid_verification_code')
}
