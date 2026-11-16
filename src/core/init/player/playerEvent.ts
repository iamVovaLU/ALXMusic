import { playNext, setMusicUrl, setMusicUrlFromOtherSource } from '@/core/player/player'
import { setStatusText } from '@/core/player/playStatus'
import { getDuration, getPosition, isEmpty, setStop } from '@/plugins/player'
import { isActive } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import { setNowPlayTime } from '@/core/player/progress'
import { initSourceHealth, recordFail, pushEvent } from '@/core/music/sourceHealth'
import { getServedSource, markBadSource } from '@/core/music/urlReserve'
import { getMinMusicDuration, parseIntervalSeconds } from '@/core/music/duration'
import settingState from '@/store/setting/state'


// 单曲最多换几次源再认输: 5 个平台 + 备胎池, 8 次足够试完还留余量
const MAX_SWITCH = 8

export default () => {
  let retryNum = 0
  let prevTimeoutId: string | null = null
  // 每次新的 URL 加载自增; 时长检查只对当次加载有效, 换源/切歌后旧结果作废
  let loadSerial = 0
  let durationCheckedSerial = -1

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
    loadSerial++
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

  // 播放器真的开始出声后才拿得到时长: 播得动但只有 16~30 秒的, 多半是试听片段/会员提示音,
  // 当换源失败处理, 继续换下一个源, 而不是当歌播下去.
  const checkPlayDuration = async() => {
    const serial = loadSerial
    const musicInfo = playerState.playMusicInfo.musicInfo
    if (!musicInfo) return
    const info = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
    if (info.source == 'local') return
    const min = getMinMusicDuration()
    if (!(min > 0)) return
    let duration = 0
    for (let i = 0; i < 3; i++) {
      try {
        duration = await getDuration()
      } catch {
        duration = 0
      }
      if (duration > 0) break
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    // 检查期间又换源/切歌了, 这个结果作废
    if (serial != loadSerial || durationCheckedSerial == serial) return
    durationCheckedSerial = serial
    // 有些格式拿不到时长, 宁可不判死刑
    if (!(duration > 0)) return
    // 原曲本身就短(比如 20 秒的间奏), 不按假音频处理
    const expected = parseIntervalSeconds(info.interval)
    if (expected > 0 && expected < min) {
      pushEvent(`原曲时长 ${expected}s < ${min}s, 跳过时长检查`)
      return
    }
    if (duration >= min) return
    const served = getServedSource(info) ?? info.source
    markBadSource(info, served)
    void initSourceHealth().then(() => {
      recordFail(settingState.setting['common.apiSource'] || '', served, 0, `short audio ${Math.round(duration)}s`)
      pushEvent(`实际时长 ${Math.round(duration)}s < ${min}s → ${served} 判为无效音频, 换源`)
    })
    setMusicUrlFromOtherSource(musicInfo)
  }

  const handlePlaying = () => {
    setStatusText('')
    clearLoadingTimeout()
    void checkPlayDuration()
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
        const source = getServedSource(info) ?? info.source
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
