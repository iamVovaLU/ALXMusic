import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { setCurrentTime, getDuration, getPosition } from '@/plugins/player'
import { formatPlayTime2 } from '@/utils/common'
import { savePlayInfo } from '@/utils/data'
import { throttleBackgroundTimer } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { onScreenStateChange } from '@/utils/nativeModules/utils'
import { AppState } from 'react-native'
import { log } from '@/utils/log'

const delaySavePlayInfo = throttleBackgroundTimer(() => {
  void savePlayInfo({
    time: playerState.progress.nowPlayTime,
    maxTime: playerState.progress.maxPlayTime,
    listId: playerState.playMusicInfo.listId!,
    index: playerState.playInfo.playIndex,
  })
}, 2000)

export default () => {
  // const updateMusicInfo = useCommit('list', 'updateMusicInfo')

  let updateTimeout: number | null = null

  let isScreenOn = true

  let seekAt = 0
  let lastMax = 0
  // 进度条走"锚点时钟": 以 (真实位置, 时间戳) 为锚, 用墙上时间推算显示值.
  // 底层 getPosition() 偶尔会短时间内跑飞(实测一次 +30s), 直接拿它画条子就会跳;
  // 但连续两次同向偏离锚点超过阈值, 说明是真的跳转(拖动/通知栏/歌词跳转), 重新锚定.
  let anchorPos = 0
  let anchorAt = 0
  let devDir = 0
  let devCount = 0
  let devPrev = 0
  let needAnchor = true
  const getCurrentTime = () => {
    let id = playerState.musicInfo.id
    void getPosition().then(position => {
      if (!position || id != playerState.musicInfo.id) return
      const now = Date.now()
      const max = playerState.progress.maxPlayTime
      const rate = Math.max(settingState.setting['player.playbackRate'] || 1, 0.1)
      // 切歌 / 恢复播放 / 时长变化: 直接以当前真实位置重新起锚
      if (needAnchor || max != lastMax) {
        needAnchor = false
        lastMax = max
        anchorPos = position
        anchorAt = now
        devDir = 0
        devCount = 0
        setNowPlayTime(position)
        return
      }
      // 拖动进度条后的一小段时间内, 不用推算值覆盖真实位置
      if (playerState.isPlay && now - seekAt > 1500) {
        const estimate = anchorPos + (now - anchorAt) / 1000 * rate
        const deviation = position - estimate
        const jump = (reanchor: string) => {
          log.warn('[ALX] progress re-anchor', {
            why: reanchor,
            pos: Number(position.toFixed(2)),
            estimate: Number(estimate.toFixed(2)),
            deviation: Number(deviation.toFixed(2)),
            rate,
            max,
          })
          anchorPos = position
          anchorAt = now
          devDir = 0
          devCount = 0
        }
        if (deviation < -1) {
          // 位置比推算值靠后: 缓冲/卡顿. 连续两次就认位置为准, 别让条子空跑
          devCount++
          devDir = -1
          if (devCount >= 2) jump('stall')
        } else if (deviation > 1.2) {
          // 位置比推算值靠前: 要么是真跳转(拖动/通知栏), 要么是底层位置跑飞.
          // 真跳转的偏移量会保持稳定, 跑飞的偏移量会一路增长 -- 用这个区分.
          const stable = devDir == 1 && Math.abs(deviation - devPrev) < 0.5
          devCount = stable ? devCount + 1 : 1
          devDir = 1
          devPrev = deviation
          if (devCount >= 3) jump('seek')
        } else {
          devDir = 0
          devCount = 0
        }
      } else if (!playerState.isPlay) {
        // 暂停期间不推算, 以真实位置为准
        anchorPos = position
        anchorAt = now
      }
      const displayPos = playerState.isPlay
        ? anchorPos + (now - anchorAt) / 1000 * rate
        : position
      setNowPlayTime(displayPos)
      if (!playerState.isPlay) return

      if (settingState.setting['player.isSavePlayTime'] && !playerState.playMusicInfo.isTempPlay && isScreenOn) {
        delaySavePlayInfo()
      }
    })
  }
  const getMaxTime = async() => {
    setMaxplayTime(await getDuration())

    if (playerState.playMusicInfo.musicInfo && 'source' in playerState.playMusicInfo.musicInfo && !playerState.playMusicInfo.musicInfo.interval) {
      // console.log(formatPlayTime2(playProgress.maxPlayTime))

      if (playerState.playMusicInfo.listId) {
        void updateListMusics([{
          id: playerState.playMusicInfo.listId,
          musicInfo: {
            ...playerState.playMusicInfo.musicInfo,
            interval: formatPlayTime2(playerState.progress.maxPlayTime),
          },
        }])
      }
    }
  }

  const clearUpdateTimeout = () => {
    if (!updateTimeout) return
    BackgroundTimer.clearInterval(updateTimeout)
    updateTimeout = null
  }
  const startUpdateTimeout = () => {
    if (!isScreenOn) return
    needAnchor = true
    clearUpdateTimeout()
    updateTimeout = BackgroundTimer.setInterval(() => {
      getCurrentTime()
    }, 500)
    getCurrentTime()
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    seekAt = Date.now()
    // 以跳转目标重新起锚, 后续按墙上时间推算
    anchorPos = time
    anchorAt = seekAt
    devDir = 0
    devCount = 0
    // console.log('setProgress', time, maxTime)
    setNowPlayTime(time)
    void setCurrentTime(time)

    if (maxTime != null) setMaxplayTime(maxTime)

    // if (!isPlay) audio.play()
  }


  const handlePlay = () => {
    needAnchor = true
    void getMaxTime()
    // prevProgressStatus = 'normal'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    startUpdateTimeout()
  }
  const handlePause = () => {
    // prevProgressStatus = 'paused'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    // clearBufferTimeout()
    clearUpdateTimeout()
  }

  const handleStop = () => {
    clearUpdateTimeout()
    setNowPlayTime(0)
    setMaxplayTime(0)
    // prevProgressStatus = 'none'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
  }

  const handleError = () => {
    // if (!restorePlayTime) restorePlayTime = getCurrentTime() // 记录出错的播放时间
    // console.log('handleError')
    // prevProgressStatus = 'error'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    clearUpdateTimeout()
  }


  const handleSetPlayInfo = () => {
    // restorePlayTime = playProgress.nowPlayTime
    // void setCurrentTime(playerState.progress.nowPlayTime)
    // setMaxplayTime(playProgress.maxPlayTime)
    handlePause()
    if (!playerState.playMusicInfo.isTempPlay) {
      void savePlayInfo({
        time: playerState.progress.nowPlayTime,
        maxTime: playerState.progress.maxPlayTime,
        listId: playerState.playMusicInfo.listId!,
        index: playerState.playInfo.playIndex,
      })
    }
  }

  // watch(() => playerState.progress.nowPlayTime, (newValue, oldValue) => {
  //   if (settingState.setting['player.isSavePlayTime'] && !playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: newValue,
  //       maxTime: playerState.progress.maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })
  // watch(() => playerState.progress.maxPlayTime, maxPlayTime => {
  //   if (!playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: playerState.progress.nowPlayTime,
  //       maxTime: maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys, settings) => {
    if (keys.includes('player.playbackRate')) startUpdateTimeout()
  }

  const handleScreenStateChanged: Parameters<typeof onScreenStateChange>[0] = (state) => {
    isScreenOn = state == 'ON'
    if (isScreenOn) {
      if (playerState.isPlay) startUpdateTimeout()
    } else clearUpdateTimeout()
  }

  // 修复在某些设备上屏幕状态改变事件未触发导致的进度条未更新的问题
  AppState.addEventListener('change', (state) => {
    if (state == 'active' && !isScreenOn) handleScreenStateChanged('ON')
  })

  global.app_event.on('play', handlePlay)
  global.app_event.on('pause', handlePause)
  global.app_event.on('stop', handleStop)
  global.app_event.on('error', handleError)
  global.app_event.on('setProgress', setProgress)
  // global.app_event.on(eventPlayerNames.restorePlay, handleRestorePlay)
  // global.app_event.on('playerLoadeddata', handleLoadeddata)
  // global.app_event.on('playerCanplay', handleCanplay)
  // global.app_event.on('playerWaiting', handleWating)
  // global.app_event.on('playerEmptied', handleEmpied)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.state_event.on('configUpdated', handleConfigUpdated)

  onScreenStateChange(handleScreenStateChanged)
}
