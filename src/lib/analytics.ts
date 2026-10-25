// 只记录获准统计的业务动作；任务号仅用于本机去重，不发送给 GA。
import type { Generation } from './api'
import { track } from './attribution'
import { analyticsAllowed } from './consent'

const PENDING = 'analytics.pending-generations'
const LOGIN = 'analytics.login-attempt'
const MAX_AGE = 7 * 86400_000
let pending: Record<string, number> = {}

function readPending() {
  try { pending = { ...pending, ...JSON.parse(localStorage.getItem(PENDING) || '{}') } } catch { /* 内存回退 */ }
  pending = Object.fromEntries(Object.entries(pending).filter(([, at]) => typeof at === 'number' && Date.now() - at < MAX_AGE).slice(-50))
  return pending
}

function savePending() {
  try { localStorage.setItem(PENDING, JSON.stringify(pending)) } catch { /* 内存回退 */ }
}

export function trackGenerationCreated(generation: Generation) {
  if (!analyticsAllowed()) return
  readPending()[generation.id] = Date.now()
  readPending()
  savePending()
  track('generate_video', { duration_id: generation.durationId, credits: generation.creditsCost })
}

export function trackGenerationResult(generation: Generation) {
  if (!analyticsAllowed() || !['succeeded', 'failed'].includes(generation.status) || !readPending()[generation.id]) return
  delete pending[generation.id]
  savePending()
  track(generation.status === 'succeeded' ? 'generation_success' : 'generation_failed', {
    duration_id: generation.durationId,
    refunded: generation.refunded,
  })
}

// 下载链接点击不是下载完成；保留诚实事件名。
export function trackVideoDownload(surface: 'generator' | 'dashboard') {
  track('video_download_click', { surface })
}

export function markGoogleLogin() {
  try { sessionStorage.setItem(LOGIN, String(Date.now())) } catch { /* 不影响登录 */ }
}

export function trackGoogleLoginReturn() {
  try {
    const started = Number(sessionStorage.getItem(LOGIN))
    sessionStorage.removeItem(LOGIN)
    if (started > 0 && Date.now() - started < 10 * 60_000) track('login', { method: 'google' })
  } catch { /* 不影响会话 */ }
}
