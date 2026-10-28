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
    'zh-CN': '模拟“听视频”功能，开启时只获取视频的音频部分，以节省流量和性能消耗。',
  },
  tags: [componentsTags.video],
  entry,
  options,
  urlInclude: videoAndBangumiUrls,
  reload: () => document.location.reload(),
  unload: () => document.location.reload(),
})
