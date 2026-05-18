import type { PluginMetadata } from '@/plugins/plugin'
import { videoChange } from '@/core/observer'
import { playerAgent } from '@/components/video/player-agent'
import { VideoInfo } from '@/components/video/video-info'

const POSITION_UPDATE_INTERVAL_MS = 5000

const setOrClearAction = (
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
) => {
  try {
    navigator.mediaSession.setActionHandler(action, handler)
  } catch {
    // action may not be supported in this browser
  }
}

const navigateToPage = (pageNumber: number) => {
  const url = new URL(window.location.href)
  url.searchParams.set('p', String(pageNumber))
  window.location.href = url.toString()
}

const navigateToBvid = (bvid: string) => {
  window.location.href = `https://www.bilibili.com/video/${bvid}`
}

export const plugin: PluginMetadata = {
  name: 'video.mpris',
  displayName: 'MPRIS 媒体控制',
  description: `通过 Media Session API 将 Bilibili 视频集成到系统媒体控制（MPRIS）：
- 标题为视频标题（多P时附带分P标题）
- 艺术家为 UP 主名称
- 专辑封面为视频封面
- 播放进度为视频进度
- 支持快进、快退、倍速
- 分P视频/合集支持上一曲和下一曲切换，并在切换视频时自动更新以上信息`,
  setup: () => {
    if (!('mediaSession' in navigator)) {
      return
    }

    const ms = navigator.mediaSession
    let currentVideoElement: HTMLVideoElement | null = null
    let positionUpdateTimer: ReturnType<typeof setInterval> | null = null
    let videoEventCleanups: (() => void)[] = []

    const clearTimer = () => {
      if (positionUpdateTimer !== null) {
        clearInterval(positionUpdateTimer)
        positionUpdateTimer = null
      }
    }

    const clearVideoEvents = () => {
      videoEventCleanups.forEach(fn => fn())
      videoEventCleanups = []
    }

    const updatePositionState = () => {
      const v = currentVideoElement
      if (!v || isNaN(v.duration) || v.duration === 0) {
        return
      }
      try {
        ms.setPositionState({
          duration: v.duration,
          position: Math.min(v.currentTime, v.duration),
          playbackRate: v.playbackRate,
        })
      } catch {
        // setPositionState may not be supported
      }
    }

    videoChange(async ({ aid, cid }) => {
      clearTimer()
      clearVideoEvents()

      const videoEl = (await playerAgent.query.video.element()) as HTMLVideoElement | null
      currentVideoElement = videoEl
      if (!videoEl) {
        return
      }

      // Use VideoInfo API to retrieve all video metadata in one call
      let info: VideoInfo
      try {
        info = await new VideoInfo(String(aid)).fetchInfo()
      } catch {
        return
      }

      const cidNum = Number(cid)

      // --- 分P (multi-page) ---
      const { pages } = info
      const isMultiPage = pages.length > 1
      const currentPageIdx = isMultiPage ? pages.findIndex(p => p.cid === cidNum) : -1

      // Display title: append part title when multi-page
      const displayTitle =
        isMultiPage && currentPageIdx >= 0
          ? `${info.title} P${pages[currentPageIdx].pageNumber} ${pages[currentPageIdx].title}`
          : info.title

      // --- 合集 (ugc_season) ---
      const seasonEpisodes = info.ugcSeason?.episodes ?? []
      const currentSeasonIdx =
        seasonEpisodes.length > 0 ? seasonEpisodes.findIndex(e => e.cid === cidNum) : -1

      // Set media metadata via VideoInfo fields
      ms.metadata = new MediaMetadata({
        title: displayTitle,
        artist: info.up.name,
        album: info.title,
        artwork: info.coverUrl
          ? [{ src: info.coverUrl, sizes: '480x270', type: 'image/jpeg' }]
          : [],
      })
      ms.playbackState = videoEl.paused ? 'paused' : 'playing'

      // Playback control handlers
      setOrClearAction('play', () => {
        videoEl.play()
      })
      setOrClearAction('pause', () => {
        videoEl.pause()
      })
      setOrClearAction('seekbackward', details => {
        const offset = details.seekOffset ?? 10
        playerAgent.changeTime(-offset)
        updatePositionState()
      })
      setOrClearAction('seekforward', details => {
        const offset = details.seekOffset ?? 10
        playerAgent.changeTime(offset)
        updatePositionState()
      })
      setOrClearAction('seekto', details => {
        if (details.seekTime !== undefined) {
          playerAgent.seek(details.seekTime)
          updatePositionState()
        }
      })

      // --- Previous / next track ---
      // A video can be BOTH in a collection (合集) AND have multiple parts (分P).
      // Navigation priority: move between parts first; when at the boundary of
      // the current video's pages, move to the adjacent episode in the collection.
      // If neither applies, fall back to the player's built-in next button.

      // Compute prev/next handlers independently so both dimensions can contribute.
      let prevHandler: MediaSessionActionHandler | null = null
      let nextHandler: MediaSessionActionHandler | null = null

      if (isMultiPage && currentPageIdx > 0) {
        // There is a previous part within the current video
        prevHandler = () => navigateToPage(pages[currentPageIdx - 1].pageNumber)
      } else if (currentSeasonIdx > 0) {
        // At first part (or single-page) of a collection episode — go to previous episode
        prevHandler = () => navigateToBvid(seasonEpisodes[currentSeasonIdx - 1].bvid)
      }

      if (isMultiPage && currentPageIdx < pages.length - 1) {
        // There is a next part within the current video
        nextHandler = () => navigateToPage(pages[currentPageIdx + 1].pageNumber)
      } else if (currentSeasonIdx >= 0 && currentSeasonIdx < seasonEpisodes.length - 1) {
        // At last part (or single-page) of a collection episode — go to next episode
        nextHandler = () => navigateToBvid(seasonEpisodes[currentSeasonIdx + 1].bvid)
      } else if (!isMultiPage && seasonEpisodes.length === 0) {
        // Single video or bangumi — delegate to player's built-in next button if available.
        // The selector targets the bpx player's next-video button; when absent or disabled
        // the handler is left as null (no nexttrack action registered), which is intentional.
        const nextBtn = document.querySelector('.bpx-player-ctrl-next') as HTMLElement | null
        if (nextBtn !== null && !nextBtn.classList.contains('bpx-state-disabled')) {
          nextHandler = () => nextBtn.click()
        }
      }

      setOrClearAction('previoustrack', prevHandler)
      setOrClearAction('nexttrack', nextHandler)

      // Position state — wait for metadata if needed
      const initPosition = () => updatePositionState()
      if (videoEl.readyState >= HTMLMediaElement.HAVE_METADATA) {
        initPosition()
      } else {
        videoEl.addEventListener('loadedmetadata', initPosition, { once: true })
        videoEventCleanups.push(() => videoEl.removeEventListener('loadedmetadata', initPosition))
      }

      // Sync playback state and position on events
      const onPlay = () => {
        ms.playbackState = 'playing'
        updatePositionState()
      }
      const onPause = () => {
        ms.playbackState = 'paused'
        updatePositionState()
      }
      const onRateChange = () => updatePositionState()

      videoEl.addEventListener('play', onPlay)
      videoEl.addEventListener('pause', onPause)
      videoEl.addEventListener('ratechange', onRateChange)
      videoEventCleanups.push(
        () => videoEl.removeEventListener('play', onPlay),
        () => videoEl.removeEventListener('pause', onPause),
        () => videoEl.removeEventListener('ratechange', onRateChange),
      )

      // Periodic position update every 5 s
      positionUpdateTimer = setInterval(updatePositionState, POSITION_UPDATE_INTERVAL_MS)
    })
  },
}
