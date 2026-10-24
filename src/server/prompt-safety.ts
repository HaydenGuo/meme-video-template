import { composeVideoPrompt, PromptSafetyError, scanLocalPrompt, scanWaffoPrompt } from '../../services/hypit-bridge/src/prompt-safety.mjs'
import { site } from '#/config/site'
import { ApiError, cleanSecret, isProduction } from './util'

// 扣积分前检查用户生成意图；Bridge 仍须扫描其服务端模板合成的完整提示词。
export async function checkGenerationPrompt(env: Env, provider: string, background: string, locale = 'en') {
  const mode = env.PROMPT_SCAN_PROVIDER ?? (isProduction(env) ? 'local' : 'mock')
  if (mode === 'mock' && !isProduction(env)) return undefined
  if (!['local', 'waffo'].includes(mode)) throw new ApiError(503, 'prompt_scan_not_configured')
  const base = provider === 'yir' ? site.video.yir.prompt : `Create an AI ${site.keyword} video using the supplied adult portrait and approved reference template.`
  try {
    const verdict = mode === 'local' ? await scanLocalPrompt(composeVideoPrompt(base, background), background) : await scanWaffoPrompt({
      merchantId: cleanSecret(env.WAFFO_MERCHANT_ID), privateKey: cleanSecret(env.WAFFO_PRIVATE_KEY),
      prompt: composeVideoPrompt(base, background), locale,
    })
    console.info('prompt-scan', JSON.stringify(verdict))
    if (verdict.action !== 'allow') throw new ApiError(422, verdict.action === 'review' ? 'prompt_review_required' : 'prompt_blocked')
    return verdict
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof PromptSafetyError) throw new ApiError(error.code === 'prompt_scan_rate_limited' ? 429 : 503, error.code, undefined, error.retryAfterSeconds)
    throw new ApiError(503, 'prompt_scan_unavailable')
  }
}
