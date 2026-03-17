import {
  defineComponentMetadata,
  defineOptionsMetadata,
  OptionsOfMetadata,
} from '@/components/define'
import { videoAndBangumiUrls } from '@/core/utils/urls'
import { hasVideo } from '@/core/spin-query'

export const options = defineOptionsMetadata({
  autoEnable: {
    defaultValue: false,
    displayName: '自动启用',
  },
  rememberProgress: {
    defaultValue: true,
    displayName: '记住播放进度',
  },
})

export type Options = OptionsOfMetadata<typeof options>

export const component = defineComponentMetadata({
  name: 'audioOnlyMode',
  displayName: '听视频',
  author: {
    name: 'GrassBlock1',
    link: 'https://github.com/GrassBlock1',
  },
  description: {
    'zh-CN':
      '只获取视频的音频部分，节省流量和性能。如果已经有播放进度，会从那一刻开始播放。',
  },
  tags: [componentsTags.video],
  entry: none,
  widget: {
    component: () => import('./AudioOnlyMode.vue').then(m => m.default),
    condition: () => hasVideo(),
  },
  options,
  urlInclude: videoAndBangumiUrls,
  reload: () => document.location.reload(),
  unload: () => document.location.reload(),
})