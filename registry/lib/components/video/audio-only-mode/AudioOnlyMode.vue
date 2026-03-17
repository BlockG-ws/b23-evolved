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
import { useScopedConsole } from '@/core/utils/log'
import { Toast } from '@/core/toast'
import { Options } from './index'

const console = useScopedConsole('听视频')

export default Vue.extend({
  components: {
    DefaultWidget,
  },
  data() {
    const settings = getComponentSettings<Options>('audioOnlyMode')
    return {
      isAudioMode: false,
      disabled: false,
      settings,
    }
  },
  computed: {
    buttonText(): string {
      return this.isAudioMode ? '退出音频模式' : '音频模式'
    },
    icon(): string {
      return this.isAudioMode ? 'mdi-headphones' : 'mdi-headphones-off'
    },
  },
  async mounted() {
    videoChange(() => {
      this.isAudioMode = false
      if (this.settings.options.autoEnable) {
        this.switchToAudioMode()
      }
    })

    if (this.settings.options.autoEnable) {
      await this.switchToAudioMode()
    }

    addComponentListener('audioOnlyMode.autoEnable', (value: boolean) => {
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
        if (!video) {
          console.error('未找到视频元素')
          Toast.error('未找到视频元素', '听视频', 2000)
          return
        }

        const savedTime = this.settings.options.rememberProgress ? video.currentTime || 0 : 0

        const { bilibiliApi, getJsonWithCredentials } = await import('@/core/ajax')
        const { formData, matchUrlPattern } = await import('@/core/utils')
        const { bangumiUrls } = await import('@/core/utils/urls')

        const aid = (unsafeWindow as any)?.aid
        const cid = (unsafeWindow as any)?.cid
        if (!aid || !cid) {
          console.error('无法获取视频参数 aid / cid，当前页面可能尚未初始化完成或不受支持。', {
            aid,
            cid,
          })
          Toast.error('未能获取视频参数，暂时无法切换到音频模式', '听视频', 3000)
          return
        }

        const params = formData({
          avid: aid,
          cid,
          qn: 30280,
          otype: 'json',
          fourk: 1,
          fnver: 0,
          fnval: 16,
        })

        const isBangumi = bangumiUrls.some((url: string) => matchUrlPattern(url))
        const apiUrl = isBangumi
          ? `https://api.bilibili.com/pgc/player/web/playurl?${params}`
          : `https://api.bilibili.com/x/player/playurl?${params}`

        const data = await bilibiliApi(getJsonWithCredentials(apiUrl), '获取音频链接失败')

        if (!data.dash || !data.dash.audio || data.dash.audio.length === 0) {
          throw new Error('没有找到音频流')
        }

        interface AudioStream {
          bandwidth: number
          baseUrl?: string
          base_url?: string
          backupUrl?: string
          backup_url?: string
        }
        const bestAudio = (data.dash.audio as AudioStream[]).reduce(
          (best, curr) => (curr.bandwidth > best.bandwidth ? curr : best),
          data.dash.audio[0] as AudioStream,
        )
        const primaryUrl = bestAudio.baseUrl || bestAudio.base_url
        const backupUrl = bestAudio.backupUrl || bestAudio.backup_url
        const rawAudioUrl = primaryUrl || backupUrl

        if (!rawAudioUrl) {
          throw new Error('没有找到可用的音频地址')
        }

        const audioUrl = rawAudioUrl.replace('http:', 'https:')

        if (savedTime > 0) {
          video.addEventListener(
            'loadedmetadata',
            () => {
              video.currentTime = savedTime
              console.log(`已恢复播放进度: ${savedTime}s`)
            },
            { once: true },
          )
        }

        video.src = audioUrl
        video.load()
        await video.play().catch((err: Error) => {
          throw new Error(`播放失败: ${err.message}`)
        })

        this.isAudioMode = true
        Toast.success('已切换到音频模式', '听视频', 2000)
        console.log('已切换到音频模式')
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
.audio-only-mode-widget {
  display: inline-block;
}
</style>