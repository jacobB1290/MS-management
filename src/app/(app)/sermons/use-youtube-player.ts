"use client"
import { useCallback, useEffect, useRef, useState } from "react"

/**
 * The shared YouTube-iframe controller behind every sermon surface that embeds
 * the service video: the read-only verification player (`SegmentPlayer`) and the
 * service editor's timestamp-capture workspace. One source of truth so the two
 * can never drift — the editor reads `getCurrentTime()` to stamp a chapter/song
 * boundary off the live playhead, and both use `seek` to jump or play a clip.
 */

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void
  playVideo(): void
  pauseVideo(): void
  getCurrentTime(): number
  destroy(): void
}
interface YTPlayerCtor {
  new (
    el: HTMLElement,
    opts: {
      videoId: string
      playerVars?: Record<string, number | string>
      events?: { onReady?: () => void }
    },
  ): YTPlayer
}
declare global {
  interface Window {
    YT?: { Player: YTPlayerCtor }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null
function loadYT(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const s = document.createElement("script")
    s.src = "https://www.youtube.com/iframe_api"
    document.head.appendChild(s)
  })
  return apiPromise
}

export type UseYouTubePlayer = {
  /** Attach to the element the iframe mounts into. */
  holderRef: React.RefObject<HTMLDivElement | null>
  /** The player has loaded and accepts commands. */
  ready: boolean
  /** Live playhead position, updated each frame while ready. */
  curSec: number
  /** The clip index currently playing to a bounded end, or null. */
  activeClip: number | null
  /**
   * Seek (and play). Pass `endSec` to auto-pause at a clip's end, and `clipIdx`
   * to mark which clip is playing (drives `activeClip` for the caller's UI).
   */
  seek: (sec: number, endSec?: number | null, clipIdx?: number | null) => void
  /** The exact current playhead, read straight from the player (for capture). */
  getCurrentTime: () => number
}

export function useYouTubePlayer(videoId: string): UseYouTubePlayer {
  const holderRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const clipEndRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [curSec, setCurSec] = useState(0)
  const [activeClip, setActiveClip] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    loadYT().then(() => {
      if (cancelled || !holderRef.current || !window.YT) return
      playerRef.current = new window.YT.Player(holderRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onReady: () => setReady(true) },
      })
    })
    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      try {
        playerRef.current?.destroy()
      } catch {
        /* player already gone */
      }
      playerRef.current = null
    }
  }, [videoId])

  useEffect(() => {
    if (!ready) return
    const tick = () => {
      const p = playerRef.current
      if (p?.getCurrentTime) {
        const t = p.getCurrentTime()
        setCurSec(t)
        if (clipEndRef.current != null && t >= clipEndRef.current) {
          try {
            p.pauseVideo()
          } catch {
            /* noop */
          }
          clipEndRef.current = null
          setActiveClip(null)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [ready])

  const seek = useCallback(
    (sec: number, endSec: number | null = null, clipIdx: number | null = null) => {
      const p = playerRef.current
      if (!p?.seekTo) return
      clipEndRef.current = endSec
      setActiveClip(clipIdx)
      try {
        p.seekTo(Math.max(0, sec), true)
        p.playVideo()
      } catch {
        /* noop */
      }
    },
    [],
  )

  const getCurrentTime = useCallback(() => {
    const p = playerRef.current
    try {
      return p?.getCurrentTime ? Math.max(0, p.getCurrentTime()) : curSec
    } catch {
      return curSec
    }
  }, [curSec])

  return { holderRef, ready, curSec, activeClip, seek, getCurrentTime }
}
