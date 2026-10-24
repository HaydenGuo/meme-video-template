import type { ReactNode } from 'react'

// 示例视频由用户手动播放，保留浏览器原生的暂停、进度、音量与全屏操作。
export function VideoCard({
  video,
  poster,
  label,
  credit,
  className = '',
}: {
  video: string
  poster: string
  label?: ReactNode
  credit?: string
  className?: string
}) {
  return (
    <figure className={className}>
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-bg-soft shadow-sm ring-1 ring-line">
        <video
          src={video}
          poster={poster}
          controls
          loop
          playsInline
          preload="metadata"
          className="size-full object-cover"
        />
        {label ? (
          <span className="pointer-events-none absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
            {label}
          </span>
        ) : null}
      </div>
      {credit ? <figcaption className="mt-2 truncate text-xs text-muted">{credit}</figcaption> : null}
    </figure>
  )
}
