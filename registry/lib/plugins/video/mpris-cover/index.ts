import type { PluginMetadata } from '@/plugins/plugin'
import { videoChange } from '@/core/observer'
import { VideoInfo } from '@/components/video/video-info'

const COVER_SIZES = '480x270'
const COVER_TYPE = 'image/jpeg'

export const plugin: PluginMetadata = {
  name: 'video.mpris-cover',
  displayName: 'MPRIS 封面同步',
  description: `将系统媒体控制（MPRIS）的专辑封面替换为当前正在播放的 Bilibili 视频封面。`,
  setup: () => {
    if (!('mediaSession' in navigator)) {
      return
    }

    const ms = navigator.mediaSession
    let requestId = 0

    videoChange(async ({ aid }) => {
      const currentId = ++requestId
      let info: VideoInfo
      try {
        info = await new VideoInfo(String(aid)).fetchInfo()
      } catch {
        return
      }

      if (currentId !== requestId) {
        return
      }

      if (!info.coverUrl) {
        return
      }

      const artwork: MediaImage[] = [{ src: info.coverUrl, sizes: COVER_SIZES, type: COVER_TYPE }]

      if (ms.metadata) {
        ms.metadata.artwork = artwork
      } else {
        ms.metadata = new MediaMetadata({ artwork })
      }
    })
  },
}
