export const PHOTO_POLICY: string
export function composeVideoPrompt(base: string, background?: string): string
export class PromptSafetyError extends Error {
  code: string
  retryAfterSeconds?: number
}
export interface PromptScanVerdict {
  action: 'allow' | 'review' | 'block'
  requestId: string
  reasonCode: string
  semanticStatus: string
  promptHash: string
}
export function scanWaffoPrompt(input: {
  merchantId?: string
  privateKey?: string
  prompt: string
  locale?: string
  fetcher?: typeof fetch
}): Promise<PromptScanVerdict>
