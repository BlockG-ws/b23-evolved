import { defineComponentMetadata } from '@/components/define'
import { ComponentEntry } from '@/components/types'
import { videoAndBangumiUrls } from '@/core/utils/urls'
import { playerReady, playerUrls } from '@/core/utils'
import { useScopedConsole } from '@/core/utils/log'

const entry: ComponentEntry = async ({ settings }) => {
  const console = useScopedConsole('听视频')
  const { videoChange } = await import('@/core/observer')
  const { select } = await import('@/core/spin-query')
  const { getPlayerAgent } = await import('@/components/video/player-agent')

  videoChange(async () => {
    try {
      await playerReady()
      const video = (await select('video')) as HTMLVideoElement
      if (! video) {
        console.error('未找到视频元素')
        return
      }

      const playerAgent = await getPlayerAgent()
      const savedTime = video.currentTime || 0

      // 等待播放器加载完成
      await new Promise(resolve => setTimeout(resolve, 1000))

      // 查找清晰度菜单
      const qualitySelector = playerAgent.isBpxPlayer
        ? '.bpx-player-ctrl-quality-menu . bpx-menu-item'
        : '.bilibili-player-video-quality-menu .bui-select-list > li. bui-select-item'

      await select(qualitySelector)
      const qualityItems = dqa(qualitySelector) as HTMLElement[]

      if (! qualityItems || qualityItems.length === 0) {
        console.warn('未找到清晰度选项')
        return
      }

      // 找到最低清晰度（通常是 360P，质量值最小）
      const lowestQuality = qualityItems.reduce((lowest, item) => {
        const currentValue = parseInt(item.getAttribute('data-value') || '999')
        const lowestValue = parseInt(lowest.getAttribute('data-value') || '999')
        return currentValue < lowestValue ? item : lowest
      }, qualityItems[0])

      // 设置事件监听器在清晰度切换后恢复播放进度
      const restoreProgress = () => {
        if (savedTime > 0) {
          video.currentTime = savedTime
          console.log(`已恢复播放进度:  ${savedTime}s`)
        }
        video.removeEventListener('loadedmetadata', restoreProgress)
      }

      video.addEventListener('loadedmetadata', restoreProgress)

      // 点击最低清晰度
      lowestQuality.click()
      console.log('已切换到音频模式（最低清晰度）')

    } catch (error) {
      console.error('切换音频模式失败:', error)
    }
  })
}

export const component = defineComponentMetadata({
  name: 'audioOnlyMode',
  displayName: '听视频',
  author: {
    name: 'GrassBlock1',
    link: 'https://github.com/GrassBlock1',
  },
  description: {
    'zh-CN': '只获取视频的音频部分（使用最低清晰度），如果已经有播放进度，会从那一刻开始播放。适合在不需要看视频画面时节省流量和性能。',
  },
  tags: [componentsTags. video],
  entry,
  urlInclude: videoAndBangumiUrls,
  reload: () => document.location.reload(),
  unload: () => document.location.reload(),
})