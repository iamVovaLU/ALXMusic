import { playNext, setMusicUrl, setMusicUrlFromOtherSource } from '@/core/player/player'
import { setStatusText } from '@/core/player/playStatus'
import { getPosition, isEmpty, setStop } from '@/plugins/player'
import { isActive } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import { setNowPlayTime } from '@/core/player/progress'
import { initSourceHealth, recordFail, pushEvent } from '@/core/music/sourceHealth'
import { markBadSource } from '@/core/music/urlReserve'
import settingState from '@/store/setting/state'


// 单曲最多换几次源再认输: 5 个平台 + 备胎池, 8 次足够试完还留余量
const MAX_SWITCH = 8

export default () => {
  let retryNum = 0
  let prevTimeoutId: string | null = null

  let loadingTimeout: number | null = null
  let delayNextTimeout: number | null = null
  const startLoadingTimeout = () => {
    // console.log('start load timeout')
    clearLoadingTimeout()
    loadingTimeout = BackgroundTimer.setTimeout(() => {
      // if (global.lx.isPlayedStop) {
      //   prevTimeoutId = null
      //   setStatusText('')
      //   return
      // }

      // 如果加载超时，则尝试刷新URL
      if (prevTimeoutId == playerState.musicInfo.id) {
        prevTimeoutId = null
        void playNext(true)
      } else {
        prevTimeoutId = playerState.musicInfo.id
        if (playerState.playMusicInfo.musicInfo) setMusicUrl(playerState.playMusicInfo.musicInfo, true)
      }
    }, 25000)
  }
  const clearLoadingTimeout = () => {
    if (!loadingTimeout) return
    // console.log('clear load timeout')
    BackgroundTimer.clearTimeout(loadingTimeout)
    loadingTimeout = null
  }

  const clearDelayNextTimeout = () => {
    // console.log(this.delayNextTimeout)
    if (!delayNextTimeout) return
    BackgroundTimer.clearTimeout(delayNextTimeout)
    delayNextTimeout = null
  }
  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    delayNextTimeout = BackgroundTimer.setTimeout(() => {
      if (global.lx.isPlayedStop) {
        setStatusText('')
        return
      }
      void playNext(true)
    }, 5000)
  }

  const handleLoadstart = () => {
    console.log('handleLoadstart', playerState.isPlay)
    if (global.lx.isPlayedStop || !playerState.isPlay) return
    startLoadingTimeout()
    setStatusText(global.i18n.t('player__loading'))
  }

  // const handleLoadeddata = () => {
  //   setStatusText(global.i18n.t('player__loading'))
  // }

  // const handleCanplay = () => {
  //   setStatusText('')
  // }

  const handlePlaying = () => {
    setStatusText('')
    clearLoadingTimeout()
  }

  const handleEmpied = () => {
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  const handleWating = () => {
    setStatusText(global.i18n.t('player__buffering'))
  }

  const handleError = () => {
    if (!playerState.musicInfo.id) return
    clearLoadingTimeout()
    if (global.lx.isPlayedStop) return
    if (playerState.playMusicInfo.musicInfo && retryNum < MAX_SWITCH) {
      let musicInfo = playerState.playMusicInfo.musicInfo
      let position = 0
      void getPosition().then((p) => {
        position = p
        if (p) setNowPlayTime(p)
      }).finally(() => {
        // console.log(this.retryNum)
        if (playerState.playMusicInfo.musicInfo !== musicInfo) return
        // ALX: 播放器报错说明"拿到的链接其实播不了". 先把这个源记为坏源,
        // 然后一直换到下一个源(优先用竞速留下的备胎), 直到真的播出声为止,
        // 不要因为探测通过就报「音频加载出错」.
        const info = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
        const source = info.source
        if (source != 'local') {
          retryNum++
          // 播了几秒才出错更像网络抖动, 刷新同一个链接, 不判这个源死刑
          if (position > 5000) {
            setMusicUrl(playerState.playMusicInfo.musicInfo, true)
            setStatusText(global.i18n.t('player__refresh_url'))
            return
          }
          markBadSource(info, source)
          void initSourceHealth().then(() => {
            recordFail(settingState.setting['common.apiSource'] || '', source, 0, 'audio load error (player)')
            pushEvent(`播放报错 → ${source} 记为坏源, 换下一个 (${retryNum}/${MAX_SWITCH})`)
          })
          setMusicUrlFromOtherSource(musicInfo)
          return
        }
        retryNum++
        setMusicUrl(playerState.playMusicInfo.musicInfo, true)
        setStatusText(global.i18n.t('player__refresh_url'))
      })
      return
    }
    if (!isEmpty()) void setStop()

    if (isActive()) {
      setStatusText(global.i18n.t('player__error'))
      setTimeout(addDelayNextTimeout)
    } else {
      console.warn('error skip to next')
      void playNext(true)
    }
  }

  const handleSetPlayInfo = () => {
    retryNum = 0
    prevTimeoutId = null
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  // const handlePlayedStop = () => {
  //   clearDelayNextTimeout()
  //   clearLoadingTimeout()
  // }


  global.app_event.on('playerLoadstart', handleLoadstart)
  // global.app_event.on('playerLoadeddata', handleLoadeddata)
  // global.app_event.on('playerCanplay', handleCanplay)
  global.app_event.on('playerPlaying', handlePlaying)
  global.app_event.on('playerWaiting', handleWating)
  global.app_event.on('playerEmptied', handleEmpied)
  global.app_event.on('playerError', handleError)
  global.app_event.on('musicToggled', handleSetPlayInfo)
}
