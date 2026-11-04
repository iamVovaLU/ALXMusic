import { TouchableOpacity } from 'react-native'
import Text from '@/components/common/Text'
import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeW } from '@/utils/pixelRatio'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { setMusicUrlFromOtherSource } from '@/core/player/player'
import { clearMusicUrlByMusic } from '@/utils/data'
import { initSourceHealth, recordFail, pushEvent } from '@/core/music/sourceHealth'

const BTN_WIDTH = scaleSizeW(36)

// 手动换源: 用于"这个源只给一分钟试听/音质不行"的情况,
// 清掉这首歌的 URL 缓存, 然后强制从别的源竞速取链接.
export default () => {
  const theme = useTheme()

  const handlePress = () => {
    const musicInfo = playerState.playMusicInfo.musicInfo
    if (!musicInfo) {
      toast('当前没有正在播放的歌曲')
      return
    }
    const info = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
    if ((info as LX.Music.MusicInfo).source == 'local') {
      toast('本地歌曲不需要换源')
      return
    }
    const apiSource = settingState.setting['common.apiSource'] || ''
    void clearMusicUrlByMusic(info as LX.Music.MusicInfo).catch(() => {})
    void initSourceHealth().then(() => {
      recordFail(apiSource, (info as LX.Music.MusicInfo).source, 0, '手动换源(试听/短音频)')
      pushEvent(`手动换源: 标记 ${(info as LX.Music.MusicInfo).source} 失败`)
    })
    toast('已清缓存，正在换源…')
    setMusicUrlFromOtherSource(musicInfo, (result) => {
      if (result) toast(`已换到 ${result.source.toUpperCase()} · ${result.quality}`)
      else toast('换源失败，没有其他可用源')
    })
  }

  return (
    <TouchableOpacity style={styles.btn} activeOpacity={0.5} onPress={handlePress}>
      <Text size={20} color={theme['c-font-label']}>⚠️</Text>
    </TouchableOpacity>
  )
}

const styles = createStyle({
  btn: {
    width: BTN_WIDTH,
    height: BTN_WIDTH,
    marginLeft: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
