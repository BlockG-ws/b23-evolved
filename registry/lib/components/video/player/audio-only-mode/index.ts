import { addControlBarButton } from '@/components/video/video-control-bar'
import { defineComponentMetadata, defineOptionsMetadata } from '@/components/define'
import type { OptionsOfMetadata } from '@/components/define'
import { videoAndBangumiUrls } from '@/core/utils/urls'
import { AudioOnlyMode } from './AudioOnlyMode'

export const options = defineOptionsMetadata({
  autoEnable: {
    defaultValue: false,
    displayName: '自动启用',
  },
  autoEnableOnBlur: {
    defaultValue: false,
    displayName: '失去焦点后自动启用',
  },
  rememberProgress: {
    defaultValue: true,
    displayName: '记住播放进度',
  },
})

export type Options = OptionsOfMetadata<typeof options>

const entry = async () => {
  const controller = new AudioOnlyMode()
  await addControlBarButton(controller.button)
  await controller.setup()
}

export const component = defineComponentMetadata({
  name: 'audioOnlyMode',
  displayName: '听视频',
  author: {
    name: 'GrassBlock1',
    link: 'https://github.com/GrassBlock1',
  },
  description: {
    'zh-CN':
      '只获取视频的音频部分，节省流量和性能。如果已经有播放进度，会从那一刻开始播放。点击播放控制栏的耳机按钮进入音频模式，再次点击即可切回当前选择的清晰度，无需刷新页面。',
  },
  tags: [componentsTags.video],
  entry,
  options,
  urlInclude: videoAndBangumiUrls,
  reload: () => document.location.reload(),
  unload: () => document.location.reload(),
})
