import type { PluginMetadata } from '@/plugins/plugin'
import { videoChange } from '@/core/observer'
import { playerAgent } from '@/components/video/player-agent'
import { getJsonWithCredentials } from '@/core/ajax'

interface PageInfo {
  cid: number
  title: string
  pageNumber: number
}

interface SeasonEpisode {
  aid: string
  bvid: string
  cid: number
  title: string
}

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
- 标题为视频标题（多 P 时附带分 P 标题）
- 艺术家为 UP 主名称
- 专辑封面为视频封面
- 播放进度为视频进度
- 支持快进、快退、倍速
- 分 P 视频/合集支持上一曲和下一曲切换，并在切换视频时自动更新以上信息`,
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

      // Fetch video info from API
      const json = await getJsonWithCredentials(
        `https://api.bilibili.com/x/web-interface/view?aid=${aid}`,
      )
      if (json.code !== 0) {
        return
      }
      const { data } = json

      const videoTitle: string = data.title ?? ''
      const upName: string = data.owner?.name ?? ''
      const coverUrl: string = (data.pic ?? '').replace('http:', 'https:')

      // Multi-page info (分P)
      const pages: PageInfo[] = (data.pages ?? []).map((p: Record<string, unknown>) => ({
        cid: Number(p.cid),
        title: String(p.part ?? ''),
        pageNumber: Number(p.page),
      }))
      const cidNum = Number(cid)
      const currentPageIdx = pages.length > 1 ? pages.findIndex(p => p.cid === cidNum) : -1

      // Display title: append part title when multi-page
      const displayTitle =
        pages.length > 1 && currentPageIdx >= 0
          ? `${videoTitle} P${pages[currentPageIdx].pageNumber} ${pages[currentPageIdx].title}`
          : videoTitle

      // Collection (ugc_season) episode list
      const seasonSections: { episodes: SeasonEpisode[] }[] = lodash.get(
        data,
        'ugc_season.sections',
        [],
      )
      const allSeasonEpisodes: SeasonEpisode[] = seasonSections.flatMap(s => s.episodes ?? [])
      const currentSeasonIdx =
        allSeasonEpisodes.length > 0
          ? allSeasonEpisodes.findIndex(e => Number(e.cid) === cidNum)
          : -1

      // Set media metadata
      ms.metadata = new MediaMetadata({
        title: displayTitle,
        artist: upName,
        album: videoTitle,
        artwork: coverUrl ? [{ src: coverUrl, sizes: '480x270', type: 'image/jpeg' }] : [],
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

      // Previous / next track navigation
      if (pages.length > 1 && currentPageIdx >= 0) {
        // Case 1: multi-page video (分P)
        const hasPrev = currentPageIdx > 0
        const hasNext = currentPageIdx < pages.length - 1
        setOrClearAction(
          'previoustrack',
          hasPrev ? () => navigateToPage(pages[currentPageIdx - 1].pageNumber) : null,
        )
        setOrClearAction(
          'nexttrack',
          hasNext ? () => navigateToPage(pages[currentPageIdx + 1].pageNumber) : null,
        )
      } else if (allSeasonEpisodes.length > 0 && currentSeasonIdx >= 0) {
        // Case 2: collection (ugc_season 合集)
        const hasPrev = currentSeasonIdx > 0
        const hasNext = currentSeasonIdx < allSeasonEpisodes.length - 1
        setOrClearAction(
          'previoustrack',
          hasPrev ? () => navigateToBvid(allSeasonEpisodes[currentSeasonIdx - 1].bvid) : null,
        )
        setOrClearAction(
          'nexttrack',
          hasNext ? () => navigateToBvid(allSeasonEpisodes[currentSeasonIdx + 1].bvid) : null,
        )
      } else {
        // Case 3: single video or bangumi — delegate to player's built-in next button
        setOrClearAction('previoustrack', null)
        const nextBtn = document.querySelector('.bpx-player-ctrl-next') as HTMLElement | null
        const hasPlayerNext = nextBtn !== null && !nextBtn.classList.contains('bpx-state-disabled')
        setOrClearAction('nexttrack', hasPlayerNext ? () => nextBtn.click() : null)
      }

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
      positionUpdateTimer = setInterval(updatePositionState, 5000)
    })
  },
}
