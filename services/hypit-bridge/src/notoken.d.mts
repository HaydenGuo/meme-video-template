export interface NoTokenSubmitOptions {
  onSubmissionStart?: () => void | Promise<void>
}

export interface NoTokenRunner {
  submit(path: string, options?: NoTokenSubmitOptions): Promise<string>
}

export function createNoTokenRunner(
  config: Record<string, unknown>,
  options?: {
    fetcher?: typeof fetch
    run?: (command: string, args: string[], options: Record<string, unknown>) => Promise<{ stdout: string }>
  },
): NoTokenRunner
