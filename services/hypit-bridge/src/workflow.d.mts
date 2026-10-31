export function buildSourceDocument(options: {
  imports: string
  media: string
  graph: string
  composition?: string
}): string

export function referenceMediaMarkup(options: {
  hasWorkflow: boolean
  passthrough: boolean
  modelVideoFile?: string
}): string

export function remixComposition(
  job: { durationSeconds: number; aspectRatio?: string },
  template: { workflow?: { type: string; frameRate: number; cutFrames: number[] }; aspectRatio?: string },
  pictureSource: string,
): { imports: string; body: string }
