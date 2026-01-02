<template>
  <div class="audio-only-mode-widget">
    <DefaultWidget
      :name="buttonText"
      :icon="icon"
      :disabled="disabled"
      @click="toggleAudioMode"
    />
  </div>
</template>

<script lang="ts">
import { DefaultWidget } from '@/ui'
import { getComponentSettings, addComponentListener } from '@/core/settings'
import { videoChange } from '@/core/observer'
import { playerReady } from '@/core/utils'
import { select } from '@/core/spin-query'
import { getPlayerAgent } from '@/components/video/player-agent'
import { useScopedConsole } from '@/core/utils/log'
import { Toast } from '@/core/toast'
import { Options } from './index'

const console = useScopedConsole('听视频')

export default Vue. extend({
  components: {
    DefaultWidget,
  },
  data() {
    const settings = getComponentSettings<Options>('audioOnlyMode')
    return {
      isAudioMode: false,
      disabled: false,
      settings,
      currentAid: unsafeWindow.aid,
    }
  },
  computed: {
    buttonText(): string {
      return this.isAudioMode ? '退出音频模式' : '音频模式'
    },
    icon(): string {
      return this.isAudioMode ? 'mdi-volume-high' : 'mdi-volume-off'
    },
  },
  async mounted() {
    // 监听视频切换
    videoChange(() => {
      this.currentAid = unsafeWindow. aid
      this.isAudioMode = false
      if (this.settings.options.autoEnable) {
        this.switchToAudioMode()
      }
    })

    // 如果设置了自动启用，初始化时就切换
    if (this.settings.options.autoEnable) {
      await this.switchToAudioMode()
    }

    // 监听设置变化
    addComponentListener('audioOnlyMode. autoEnable', (value: boolean) => {
      if (value && !this.isAudioMode) {
        this.switchToAudioMode()
      }
    })
  },
  methods: {
    async toggleAudioMode() {
      if (this.isAudioMode) {
        Toast.info('请刷新页面以退出音频模式', '听视频', 2000)
      } else {
        await this.switchToAudioMode()
      }
    },
    async switchToAudioMode() {
      if (this.disabled) {
        return
      }

      try {
        this.disabled = true
        await playerReady()
        
        const video = (await select('video')) as HTMLVideoElement
        if (! video) {
          console.error('未找到视频元素')
          Toast.error('未找到视频元素', '听视频', 2000)
          return
        }

        const playerAgent = await getPlayerAgent()
        const savedTime = this.settings.options.rememberProgress ?  video.currentTime || 0 : 0

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
          Toast.error('未找到清晰度选项', '听视频', 2000)
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

        if (this.settings.options.rememberProgress) {
          video.addEventListener('loadedmetadata', restoreProgress)
        }

        // 点击最低清晰度
        lowestQuality.click()
        this.isAudioMode = true
        
        Toast.success('已切换到音频模式（最低清晰度）', '听视频', 2000)
        console.log('已切换到音频模式（最低清晰度）')
      } catch (error) {
        console.error('切换音频模式失败:', error)
        Toast.error(`切换失败: ${error.message}`, '听视频', 3000)
      } finally {
        this.disabled = false
      }
    },
  },
})
</script>

<style lang="scss" scoped>
. audio-only-mode-widget {
  display: inline-block;
}
</style>