import { addComponentListener, getComponentSettings } from '@/core/settings'
import { videoChange } from '@/core/observer'
import { delay, formData, matchUrlPattern, playerReady } from '@/core/utils'
import { bangumiUrls } from '@/core/utils/urls'
import { bilibiliApi, getJsonWithCredentials } from '@/core/ajax'
import { select } from '@/core/spin-query'
import { useScopedConsole } from '@/core/utils/log'
import { Toast } from '@/core/toast'
import type { VideoControlBarItem } from '@/components/video/video-control-bar'
import type { Options } from './index'

const console = useScopedConsole('听视频')
const BLUR_AUTO_ENABLE_DELAY_MS = 30 * 1000
// 等待播放器完成重载并重新挂载视频流
const RESTORE_TIMEOUT_MS = 10 * 1000
const RESTORE_POLL_INTERVAL_MS = 100
// 无刷新切换视频后, 等播放器稳定下来再尝试进入音频模式
const AUTO_ENABLE_SETTLE_DELAY_MS = 800

interface NativePlayer {
  reload?: () => unknown
  seek?: (time: number) => unknown
  pause?: () => void
}

const waitFor = async <T>(
  getter: () => T | null,
  timeout: number,
  interval: number,
): Promise<T | null> => {
  const deadline = Date.now() + timeout
  while (Date.now() <= deadline) {
    const value = getter()
    if (value) {
      return value
    }
    await delay(interval)
  }
  return null
}

export class AudioOnlyMode {
  private readonly settings = getComponentSettings<Options>('audioOnlyMode')
  private isAudioMode = false
  private disabled = false
  private blurTimer: ReturnType<typeof setTimeout> | null = null
  private initialAutoEnableAttempted = false
  private audioUrl: string | null = null
  private originalSrc: string | null = null

  readonly button: VideoControlBarItem = {
    name: 'audioOnlyMode',
    displayName: '听视频',
    icon: 'mdi-headphones-off',
    order: 3,
    action: () => this.toggleAudioMode(),
  }

  async setup() {
    videoChange(async () => {
      this.setAudioMode(false)
      this.audioUrl = null
      this.originalSrc = null
      if (this.settings.options.autoEnable && !this.initialAutoEnableAttempted) {
        this.initialAutoEnableAttempted = true
        await delay(AUTO_ENABLE_SETTLE_DELAY_MS)
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
  }

  private setupBlurListener() {
    // Remove first to prevent duplicate registrations if called multiple times.
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private teardownBlurListener() {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.clearBlurTimer()
  }

  private handleVisibilityChange = () => {
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
  }

  private clearBlurTimer() {
    if (this.blurTimer !== null) {
      clearTimeout(this.blurTimer)
      this.blurTimer = null
    }
  }

  private setAudioMode(enabled: boolean) {
    this.isAudioMode = enabled
    this.button.displayName = enabled ? '退出音频模式' : '听视频'
    this.button.icon = enabled ? 'mdi-headphones' : 'mdi-headphones-off'
  }

  private async toggleAudioMode() {
    if (this.isAudioMode) {
      await this.exitAudioMode()
    } else {
      await this.switchToAudioMode()
    }
  }

  private async switchToAudioMode() {
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

      const { aid, cid } = unsafeWindow
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
      const primaryUrl = (bestAudio.baseUrl || bestAudio.base_url || '').replace('http:', 'https:')
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

      this.originalSrc = video.src || null

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

      this.audioUrl = audioUrl
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

      this.setAudioMode(true)
      Toast.success('已切换到音频模式', '听视频', 2000)
      console.log('已切换到音频模式')
    } catch (error) {
      console.error('切换音频模式失败:', error)
      Toast.error(`切换失败: ${error.message}`, '听视频', 3000)
    } finally {
      this.disabled = false
    }
  }

  private async exitAudioMode() {
    if (this.disabled) {
      return
    }

    try {
      this.disabled = true

      const video = dq('video') as HTMLVideoElement | null
      if (!video) {
        console.error('未找到视频元素')
        Toast.error('未找到视频元素', '听视频', 2000)
        return
      }

      const savedTime = video.currentTime || 0
      const wasPaused = video.paused
      const player: NativePlayer | null = unsafeWindow.player ?? null

      if (player?.reload) {
        try {
          // 重载会让播放器按当前选择的清晰度重新挂载视频流, 不需要额外记录清晰度
          await Promise.race([Promise.resolve(player.reload()), delay(RESTORE_TIMEOUT_MS)])
        } catch (error) {
          console.warn('播放器重载失败，尝试直接恢复原视频地址', error)
        }
      } else if (this.originalSrc) {
        video.src = this.originalSrc
        video.load()
      }

      const restored = await waitFor(
        () => {
          const current = dq('video') as HTMLVideoElement | null
          if (!current || current.currentSrc === this.audioUrl) {
            return null
          }
          // 音频流没有视频尺寸, 以此确认播放器已经重新挂载了视频流
          if (current.readyState < HTMLMediaElement.HAVE_METADATA || current.videoWidth === 0) {
            return null
          }
          return current
        },
        RESTORE_TIMEOUT_MS,
        RESTORE_POLL_INTERVAL_MS,
      )

      if (!restored) {
        throw new Error('播放器未能恢复视频流')
      }

      const seek = player?.seek
      if (seek) {
        seek.call(player, savedTime)
        const seekApplied = await waitFor(
          () => {
            const current = dq('video') as HTMLVideoElement | null
            return current && Math.abs(current.currentTime - savedTime) < 2 ? current : null
          },
          2000,
          RESTORE_POLL_INTERVAL_MS,
        )
        if (!seekApplied) {
          restored.currentTime = savedTime
        }
      } else {
        restored.currentTime = savedTime
      }

      if (wasPaused) {
        player?.pause?.()
        restored.pause()
      } else if (restored.paused) {
        await restored.play().catch(error => console.warn('恢复播放失败:', error))
      }

      this.audioUrl = null
      this.originalSrc = null
      this.setAudioMode(false)
      Toast.success('已退出音频模式', '听视频', 2000)
      console.log('已退出音频模式')
    } catch (error) {
      console.error('退出音频模式失败:', error)
      Toast.error(`退出音频模式失败: ${error.message}，请刷新页面重试`, '听视频', 3000)
    } finally {
      this.disabled = false
    }
  }
}
