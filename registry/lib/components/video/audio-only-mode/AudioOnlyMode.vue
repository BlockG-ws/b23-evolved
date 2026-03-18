<template>
  <div class="audio-only-mode-widget">
    <DefaultWidget :name="buttonText" :icon="icon" :disabled="disabled" @click="toggleAudioMode" />
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
const BLUR_AUTO_ENABLE_DELAY_MS = 30 * 1000

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
      blurTimer: null as ReturnType<typeof setTimeout> | null,
      initialAutoEnableAttempted: false as boolean,
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
    videoChange(async () => {
      this.isAudioMode = false
      if (this.settings.options.autoEnable && !this.initialAutoEnableAttempted) {
        this.initialAutoEnableAttempted = true
        // Wait briefly for the player to settle after a no-refresh video change
        // before attempting to switch to audio mode, to avoid AbortError.
        await new Promise(r => setTimeout(r, 800))
        this.switchToAudioMode()
      }
    })

    if (this.settings.options.autoEnable && !this.initialAutoEnableAttempted) {
      this.initialAutoEnableAttempted = true
      await this.switchToAudioMode()
    }

    addComponentListener('audioOnlyMode.autoEnable', (value: boolean) => {
      if (value && !this.isAudioMode) {
        this.switchToAudioMode()
      }
    })

    if (this.settings.options.autoEnableOnBlur) {
      this.setupBlurListener()
    }

    addComponentListener('audioOnlyMode.autoEnableOnBlur', (value: boolean) => {
      if (value) {
        this.setupBlurListener()
      } else {
        this.teardownBlurListener()
      }
    })
  },
  beforeDestroy() {
    this.teardownBlurListener()
  },
  methods: {
    setupBlurListener() {
      // Remove first to prevent duplicate registrations if called multiple times.
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
    },
    teardownBlurListener() {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      this.clearBlurTimer()
    },
    handleVisibilityChange() {
      if (document.hidden) {
        // Clear any existing timer before starting a new one to avoid orphaned timeouts.
        this.clearBlurTimer()
        this.blurTimer = setTimeout(() => {
          // Re-check visibility to avoid switching modes if the page is visible again.
          if (document.hidden && !this.isAudioMode) {
            this.switchToAudioMode()
          }
        }, BLUR_AUTO_ENABLE_DELAY_MS)
      } else {
        this.clearBlurTimer()
      }
    },
    clearBlurTimer() {
      if (this.blurTimer !== null) {
        clearTimeout(this.blurTimer)
        this.blurTimer = null
      }
    },
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
          backupUrl?: string[]
          backup_url?: string[]
        }
        const bestAudio = (data.dash.audio as AudioStream[]).reduce(
          (best, curr) => (curr.bandwidth > best.bandwidth ? curr : best),
          data.dash.audio[0] as AudioStream,
        )
        const primaryUrl = (bestAudio.baseUrl || bestAudio.base_url || '').replace(
          'http:',
          'https:',
        )
        const backupUrls = (bestAudio.backupUrl || bestAudio.backup_url || []).map((u: string) =>
          u.replace('http:', 'https:'),
        )
        const allUrls = [primaryUrl, ...backupUrls].filter(Boolean)

        if (allUrls.length === 0) {
          throw new Error('没有找到可用的音频地址')
        }

        const isMcdnOrP2pUrl = (url: string): boolean => {
          try {
            const { hostname, port, searchParams } = new URL(url)
            const os = searchParams.get('os')?.toLowerCase()
            const hasNonStandardPort = port !== '' && port !== '80' && port !== '443'
            return (
              os === 'mcdn' ||
              hostname.includes('mcdn') ||
              hasNonStandardPort ||
              searchParams.has('p2p_type')
            )
          } catch {
            // Treat unparseable URLs as "bad/unknown" (MCDN/P2P) to avoid preferring them.
            return true
          }
        }

        const audioUrl = allUrls.find(url => !isMcdnOrP2pUrl(url)) ?? allUrls[0]
        if (isMcdnOrP2pUrl(audioUrl)) {
          console.warn('所有可用音频地址均为 MCDN/P2P，可能因其他脚本干扰而导致播放失败')
        }

        if (!video.isConnected) {
          throw new Error('视频元素已从页面中移除，请刷新后重试')
        }

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

        let playAborted = false
        await video.play().catch((err: DOMException) => {
          if (err.name === 'AbortError') {
            // AbortError is expected when a no-refresh video navigation interrupts
            // the play() call before it can complete. This is not a real failure;
            // the next videoChange event will trigger another switch attempt.
            console.warn('播放被中止 (AbortError)，可能由视频切换引起，将等待下次触发')
            playAborted = true
            return
          }
          throw new Error(`播放失败: ${err.message}`)
        })

        if (playAborted) {
          return
        }

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
