// 歌曲时长相关的小工具
import settingState from '@/store/setting/state'

export const DEFAULT_MIN_MUSIC_DURATION = 30

// 配置项: 小于这个秒数的音频不算"歌"(试听片段/会员提示音), 按换源失败处理
export const getMinMusicDuration = (): number => {
  const v = settingState.setting['player.minMusicDuration']
  if (typeof v != 'number' || !Number.isFinite(v) || v < 0) return DEFAULT_MIN_MUSIC_DURATION
  return v
}

// '03:55' / '1:02:03' -> 秒
export const parseIntervalSeconds = (interval?: string | null): number => {
  if (!interval) return 0
  const parts = interval.split(':').map(s => parseInt(s, 10))
  if (!parts.length || parts.some(n => Number.isNaN(n))) return 0
  let sec = 0
  for (const n of parts) sec = sec * 60 + n
  return sec
}
