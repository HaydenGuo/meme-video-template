import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ErrorText, GoogleIcon, LocalLink, LogoMark, Spinner } from '#/components/ui'
import { api, errorCode, featureEnabled } from '#/lib/api'
import { track } from '#/lib/attribution'
import { markGoogleLogin } from '#/lib/analytics'
import { getContent, localeFromParam, pageHead, useContent, useLocale, useLocalePath } from '#/lib/i18n'
import { safeRedirectPath } from '#/lib/redirect'
import { useSession } from '#/lib/session'

type Mode = 'login' | 'register' | 'reset'
type Search = { redirect?: string; error?: string; mode?: Mode }

export const Route = createFileRoute('/{-$locale}/sign-in')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    mode: search.mode === 'register' || search.mode === 'reset' ? search.mode : 'login',
  }),
  head: ({ params }) => {
    const locale = localeFromParam(params.locale)
    const c = getContent(locale)
    const head = pageHead(locale, '/sign-in', c.meta.signInTitle, c.signIn.body)
    return { ...head, meta: [...head.meta, { name: 'robots', content: 'noindex' }] }
  },
  component: SignInPage,
})

function SignInPage() {
  const c = useContent()
  const t = c.signIn
  const locale = useLocale()
  const lp = useLocalePath()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { user, config, loading, refresh } = useSession()
  const redirect = safeRedirectPath(search.redirect, lp('/dashboard'))
  const [email, setEmail] = useState('')
  const [devEmail, setDevEmail] = useState('demo@example.com')
  const [mode, setMode] = useState<Mode>(search.mode ?? 'login')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [code, setCode] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [retrySeconds, setRetrySeconds] = useState(0)
  const emailInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(search.error ?? null)

  useEffect(() => {
    if (user) void navigate({ href: redirect })
  }, [user, redirect, navigate])

  useEffect(() => {
    if (retrySeconds <= 0) return
    const timer = setTimeout(() => setRetrySeconds((n) => Math.max(0, n - 1)), 1000)
    return () => clearTimeout(timer)
  }, [retrySeconds])

  function switchMode(next: Mode) {
    setMode(next)
    setPassword('')
    setConfirmation('')
    setCode('')
    setChallengeId(null)
    setDevelopmentCode(null)
    setError(null)
  }

  async function sendCode() {
    if (!emailInput.current?.reportValidity()) return
    setSending(true)
    setError(null)
    try {
      const data = await api<{ challengeId: string; developmentCode?: string }>('/api/auth/email/code', {
        json: { email, purpose: mode === 'reset' ? 'reset' : 'register', locale },
      })
      setChallengeId(data.challengeId)
      setDevelopmentCode(data.developmentCode ?? null)
      setCode('')
      setRetrySeconds(60)
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setSending(false)
    }
  }

  async function emailSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (mode !== 'login' && password !== confirmation) return setError('password_mismatch')
    if (mode !== 'login' && !challengeId) return setError('invalid_verification_code')
    setPending(true)
    try {
      const action = mode === 'reset' ? 'reset-password' : mode
      await api(`/api/auth/email/${action}`, { json: { email, password, code, challengeId, locale } })
      track('login', { method: 'email' })
      await refresh()
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setPending(false)
    }
  }

  async function devLogin(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await api('/api/auth/dev-login', { json: { email: devEmail } })
      await refresh()
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setPending(false)
    }
  }

  if (!loading && !featureEnabled(config, 'auth')) return <main className="container-page py-24 text-center"><h1 className="font-display text-3xl">{c.common.comingSoon}</h1><p className="my-6">{c.common.signInUnavailable}</p><LocalLink to="/">{c.common.home}</LocalLink></main>
  return (
    <div className="container-page grid max-w-md place-items-center py-20">
      <div className="card w-full space-y-6 p-8 text-center">
        <LogoMark className="mx-auto size-12 text-base" />
        <div className="space-y-2">
          <h1 className="font-display text-3xl">{mode === 'register' ? t.registerTitle : mode === 'reset' ? t.resetTitle : t.title}</h1>
          <p className="text-sm text-muted">{mode === 'reset' ? t.resetBody : t.body}</p>
        </div>
        {loading ? (
          <Spinner className="mx-auto size-5" />
        ) : mode !== 'reset' ? (
          <div className="space-y-2">
            {config?.googleClientId ? (
              <a href={`/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`} className="btn-ghost w-full py-3.5" data-testid="google-sign-in" onClick={markGoogleLogin}>
                <GoogleIcon /> {t.google}
              </a>
            ) : (
              <button type="button" className="btn-ghost w-full py-3.5 disabled:opacity-60" disabled aria-describedby="google-unavailable" data-testid="google-sign-in">
                <GoogleIcon /> {t.google}
              </button>
            )}
            {!config?.googleClientId ? <p id="google-unavailable" className="text-xs text-muted">{t.notConfigured}</p> : null}
          </div>
        ) : null}
        {!loading ? (
          <>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-bg-soft p-1">
              {(['login', 'register'] as const).map((next) => (
                <button key={next} type="button" aria-pressed={mode === next} disabled={pending || sending}
                  onClick={() => switchMode(next)} data-testid={`email-tab-${next}`}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === next ? 'bg-card shadow-sm' : 'text-muted'}`}>
                  {next === 'login' ? t.loginTab : t.registerTab}
                </button>
              ))}
            </div>
            {config?.emailPassword && (mode === 'login' || config.emailVerification) ? (
              <form onSubmit={emailSubmit} className="space-y-4 text-left" data-testid="email-auth-form">
                <label className="block space-y-1.5 text-sm">
                  <span>{t.emailLabel}</span>
                  <input ref={emailInput} className="input" type="email" autoComplete="email" required maxLength={254}
                    disabled={pending || sending} value={email} data-testid="auth-email"
                    onChange={(event) => { setEmail(event.target.value); setChallengeId(null); setDevelopmentCode(null); setCode('') }} />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span>{t.passwordLabel}</span>
                  <input className="input" type="password" required minLength={mode === 'login' ? 1 : 10} maxLength={128}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={pending || sending}
                    value={password} onChange={(event) => setPassword(event.target.value)} data-testid="auth-password" />
                  {mode !== 'login' ? <span className="block text-xs text-muted">{t.passwordHint}</span> : null}
                </label>
                {mode !== 'login' ? (
                  <>
                    <label className="block space-y-1.5 text-sm">
                      <span>{t.confirmPassword}</span>
                      <input className="input" type="password" required minLength={10} maxLength={128} autoComplete="new-password"
                        disabled={pending || sending} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} data-testid="auth-confirm-password" />
                    </label>
                    <label className="block space-y-1.5 text-sm">
                      <span>{t.codeLabel}</span>
                      <span className="flex items-center gap-2">
                        <input className="input min-w-0 flex-1" type="text" inputMode="numeric" autoComplete="one-time-code"
                          pattern="[0-9]{6}" minLength={6} maxLength={6} required disabled={pending || sending}
                          value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} data-testid="auth-code" />
                        <button type="button" className="btn-ghost shrink-0 px-3 text-xs" disabled={pending || sending || retrySeconds > 0}
                          onClick={() => void sendCode()} data-testid="auth-send-code">
                          {sending ? <Spinner /> : null}{retrySeconds > 0 ? t.resendIn(retrySeconds) : t.sendCode}
                        </button>
                      </span>
                    </label>
                    {challengeId ? <p className="text-xs leading-5 text-muted" role="status">{developmentCode ? t.developmentCode(developmentCode) : t.codeSent}</p> : null}
                  </>
                ) : null}
                <button type="submit" className="btn-primary w-full py-3.5" disabled={pending || sending} data-testid="auth-submit">
                  {pending ? <Spinner /> : null}{mode === 'register' ? t.registerSubmit : mode === 'reset' ? t.resetSubmit : t.emailSubmit}
                </button>
                <button type="button" className="block w-full text-center text-sm text-muted underline" disabled={pending || sending}
                  onClick={() => switchMode(mode === 'reset' ? 'login' : 'reset')}>
                  {mode === 'reset' ? t.backToLogin : t.forgotPassword}
                </button>
              </form>
            ) : <p className="text-sm text-muted">{t.emailUnavailable}</p>}
          </>
        ) : null}
        {config?.devLogin ? (
          <details className="border-t border-line pt-4 text-left">
            <summary className="cursor-pointer text-xs text-muted">{t.devTitle}</summary>
            <form onSubmit={devLogin} className="mt-3 space-y-3 text-left">
              <label className="block space-y-1.5 text-sm">
                <span>{t.devEmail}</span>
                <input className="input" type="email" required value={devEmail} onChange={(e) => setDevEmail(e.target.value)} data-testid="dev-email" />
              </label>
              <button type="submit" className="btn-ghost w-full" disabled={pending || sending} data-testid="dev-login">
                {pending ? <Spinner /> : null} {t.devSubmit}
              </button>
            </form>
          </details>
        ) : null}
        <ErrorText code={error} />
        <p className="text-xs text-muted">
          <LocalLink to="/terms-of-service" className="underline">
            {t.legal}
          </LocalLink>
        </p>
      </div>
    </div>
  )
}
