import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { RequestAttribution } from './attribution'
import { ledgerStatements } from './credits'
import { bindReferralStatement, type SignupReferral } from './referrals'
import { getSettings } from './settings'
import type { AppContext, UserRow } from './types'
import { ApiError, createId, isProduction, isUniqueConstraintError, nowIso, randomToken, sha256Hex } from './util'

const SESSION_DAYS = 30
const DEFAULT_OWNER_INITIAL_CREDIT_EMAIL_HASH = '4ca86ba9504ce8f2158ce97259c71eb51a6a9c10102bfe824a269dd54af665f5'
const OWNER_INITIAL_CREDIT_AMOUNT = 100

async function ownerInitialCreditKey(email: string, env: Env) {
  const emailHash = await sha256Hex(email.trim().toLowerCase())
  const configuredHash = env.OWNER_INITIAL_CREDIT_EMAIL_HASH?.trim().toLowerCase() || DEFAULT_OWNER_INITIAL_CREDIT_EMAIL_HASH
  return emailHash === configuredHash ? `owner_initial:${emailHash}` : null
}

async function grantOwnerInitialCredits(db: D1Database, userId: string, email: string, env: Env) {
  const idempotencyKey = await ownerInitialCreditKey(email, env)
  if (!idempotencyKey) return
  const alreadyGranted = await db.prepare('SELECT 1 AS granted FROM credit_ledger WHERE idempotency_key = ?').bind(idempotencyKey).first()
  if (alreadyGranted) return
  try {
    await db.batch(ledgerStatements(db, {
      userId,
      delta: OWNER_INITIAL_CREDIT_AMOUNT,
      reason: 'signup_bonus',
      refId: 'owner_initial',
      idempotencyKey,
      note: 'Initial owner credits',
    }))
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const completed = await db.prepare('SELECT 1 AS granted FROM credit_ledger WHERE idempotency_key = ?').bind(idempotencyKey).first()
    if (!completed) throw error
  }
}

export function sessionCookieName(env: Env) {
  // __Host- 前缀要求 Secure + Path=/ + 无 Domain，只在 HTTPS 生产环境使用
  return isProduction(env) ? '__Host-sid' : 'sid'
}

export async function loadSessionUser(c: Context<AppContext>): Promise<UserRow | null> {
  const token = getCookie(c, sessionCookieName(c.env))
  if (!token) return null
  const id = await sha256Hex(token)
  const user = await c.env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(id, nowIso())
    .first<UserRow>()
  if (!user || user.status !== 'active') return null
  return user
}

export async function startSession(c: Context<AppContext>, userId: string, expectedPasswordHash?: string) {
  const token = randomToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)
  const created = await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent, ip) SELECT ?, ?, ?, ?, ?, ?${
      expectedPasswordHash === undefined ? '' : ` WHERE EXISTS (
        SELECT 1 FROM email_credentials ec JOIN users u ON u.id = ec.user_id
        WHERE ec.user_id = ? AND ec.password_hash = ? AND u.status = 'active'
      )`
    }`,
  )
    .bind(
      await sha256Hex(token),
      userId,
      expires.toISOString(),
      nowIso(),
      c.req.header('user-agent')?.slice(0, 300) ?? null,
      c.req.header('cf-connecting-ip') ?? null,
      ...(expectedPasswordHash === undefined ? [] : [userId, expectedPasswordHash]),
    )
    .run()
  // 密码校验后如发生并发重置，禁止旧密码再签发一个新会话。
  if (!created.meta.changes) throw new ApiError(401, 'invalid_credentials')
  setCookie(c, sessionCookieName(c.env), token, {
    httpOnly: true,
    secure: isProduction(c.env),
    sameSite: 'Lax',
    path: '/',
    expires,
  })
}

export async function endSession(c: Context<AppContext>) {
  const name = sessionCookieName(c.env)
  const token = getCookie(c, name)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run()
  deleteCookie(c, name, { path: '/', secure: isProduction(c.env) })
}

export function adminEmails(env: Env) {
  return env.ADMIN_EMAILS.split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(env: Env, email: string) {
  return adminEmails(env).includes(email.toLowerCase())
}

export interface SignInProfile {
  email: string
  name: string | null
  picture: string | null
  googleSub: string | null
  country: string | null
  locale: string | null
  attribution?: RequestAttribution | null // 仅新用户注册时写入
  referral?: SignupReferral | null // 仅新用户注册时绑定邀请人
  createOnly?: boolean // 未验证邮箱的密码注册不得绑定到既有 Google 账户
  emailVerified?: boolean // 未验证邮箱账户不发注册积分或邀请奖励
  passwordHash?: string // 新用户和邮箱凭据必须原子创建，避免并发 Google 登录接管竞态
}

// 注销账号只留邮箱的加盐哈希（deleted_accounts），用来识别“注销后用同一邮箱重新注册”。
// 盐是 SESSION_SECRET：换密钥后旧记录对不上，这些邮箱会再领一次注册赠送
export async function deletedEmailHash(env: Env, email: string) {
  return sha256Hex(`deleted-email:${env.SESSION_SECRET ?? ''}:${email.trim().toLowerCase()}`)
}

// Google、已验证邮箱与 dev 登录共用：先按 google_sub、再按规范化邮箱找人，没有就创建。
// 账号以 Google 的 sub 为准：邮箱相同但已绑定另一个 sub 时拒绝登录（Google 账号被删后同一邮箱可以注册成新账号），
// 只有 google_sub 为空的账号才按邮箱绑定；未验证邮箱的密码注册必须设置 createOnly。
export async function upsertUser(env: Env, profile: SignInProfile, retried = false): Promise<UserRow> {
  const email = profile.email.trim().toLowerCase()
  const db = env.DB
  const existing = await db
    .prepare(
      `SELECT * FROM users WHERE (google_sub IS NOT NULL AND google_sub = ?1) OR lower(trim(email)) = ?2
       ORDER BY CASE WHEN google_sub = ?1 THEN 0 ELSE 1 END LIMIT 1`,
    )
    .bind(profile.googleSub, email)
    .first<UserRow>()
  const now = nowIso()
  const role = profile.emailVerified === false ? undefined : isAdminEmail(env, email) ? 'admin' : undefined

  if (existing) {
    if (profile.createOnly) throw new ApiError(409, 'email_account_exists')
    if (existing.status !== 'active') throw new ApiError(403, 'account_disabled')
    if (profile.googleSub && existing.google_sub && existing.google_sub !== profile.googleSub) {
      console.warn('sign-in rejected: email bound to another google account', existing.id)
      throw new ApiError(409, 'account_conflict')
    }
    let retireUnverifiedPassword = false
    if (profile.googleSub && !existing.google_sub) {
      const credential = await db.prepare('SELECT verified_at FROM email_credentials WHERE user_id = ?').bind(existing.id).first<{ verified_at: string | null }>()
      retireUnverifiedPassword = !!credential && credential.verified_at === null
    }
    const update = db.prepare(
      `UPDATE users SET name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url),
       google_sub = COALESCE(google_sub, ?), role = COALESCE(?, role), last_login_at = ? WHERE id = ?`,
    ).bind(profile.name, profile.picture, profile.googleSub, role ?? null, now, existing.id)
    if (retireUnverifiedPassword) {
      // Google has now proved control of this address. Retire credentials created before inbox verification
      // so a registrant who guessed the address cannot keep password access after the rightful owner signs in.
      await db.batch([
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(existing.id),
        db.prepare('DELETE FROM email_credentials WHERE user_id = ?').bind(existing.id),
        db.prepare('DELETE FROM email_auth_challenges WHERE email = ?').bind(email),
        db.prepare('DELETE FROM email_auth_limits WHERE scope = ?').bind(`login:${email}`),
        update,
      ])
    } else {
      await update.run()
    }
    if (profile.emailVerified !== false) await grantOwnerInitialCredits(db, existing.id, existing.email, env)
    return (await db.prepare('SELECT * FROM users WHERE id = ?').bind(existing.id).first<UserRow>())!
  }

  const id = createId('usr')
  const statements = [
    db
      .prepare(
        `INSERT INTO users (id, email, name, avatar_url, google_sub, role, status, credits, locale, country,
         signup_source, signup_medium, signup_campaign, signup_device, attribution, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        email,
        profile.name,
        profile.picture,
        profile.googleSub,
        role ?? 'user',
        profile.locale,
        profile.country ?? profile.attribution?.country ?? null,
        profile.attribution?.source ?? null,
        profile.attribution?.medium ?? null,
        profile.attribution?.campaign ?? null,
        profile.attribution?.device ?? null,
        profile.attribution?.json ?? null,
        now,
        now,
      ),
  ]
  if (profile.passwordHash) {
    statements.push(
      db.prepare('INSERT INTO email_credentials (user_id, password_hash, verified_at, updated_at) VALUES (?, ?, NULL, ?)')
        .bind(id, profile.passwordHash, now),
    )
  }
  // 注销过的邮箱重新注册：不发注册赠送、不绑定邀请人
  const returning = await db
    .prepare('SELECT 1 AS hit FROM deleted_accounts WHERE email_hash = ?')
    .bind(await deletedEmailHash(env, email))
    .first<{ hit: number }>()
  const emailVerified = profile.emailVerified !== false
  if (profile.referral && !returning && emailVerified) statements.push(bindReferralStatement(db, id, profile.referral, now))
  const { signupBonusCredits, signupBonusValidDays } = await getSettings(env)
  if (signupBonusCredits > 0 && !returning && emailVerified) {
    statements.push(
      ...ledgerStatements(db, {
        userId: id,
        delta: signupBonusCredits,
        reason: 'signup_bonus',
        idempotencyKey: `signup:${id}`,
        expiresAt: signupBonusValidDays > 0 ? new Date(Date.now() + signupBonusValidDays * 86400_000).toISOString() : null,
      }),
    )
  }
  const ownerCreditKey = await ownerInitialCreditKey(email, env)
  if (!returning && emailVerified && ownerCreditKey) {
    statements.push(...ledgerStatements(db, {
      userId: id,
      delta: OWNER_INITIAL_CREDIT_AMOUNT,
      reason: 'signup_bonus',
      refId: 'owner_initial',
      idempotencyKey: ownerCreditKey,
      note: 'Initial owner credits',
    }))
  }
  try {
    await db.batch(statements)
  } catch (error) {
    // Google 和邮箱注册并发时，普通 OAuth 可复用胜出的账户；未验证邮箱注册则不能绑定到该账户。
    if (profile.createOnly && isUniqueConstraintError(error)) throw new ApiError(409, 'email_account_exists')
    if (!retried && isUniqueConstraintError(error)) return upsertUser(env, profile, true)
    throw error
  }
  return (await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>())!
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    role: user.role,
    credits: user.credits,
    createdAt: user.created_at,
  }
}
