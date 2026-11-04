import { arrPush, arrUnshift, formatPlayTime2 } from '@/utils'
import state from './state'

const clampProgress = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

type PlayerMusicInfoKeys = keyof LX.Player.MusicInfo
const musicInfoKeys: PlayerMusicInfoKeys[] = Object.keys(state.musicInfo) as PlayerMusicInfoKeys[]

export default {
  updatePlayIndex(playIndex: number, playerPlayIndex: number) {
    state.playInfo.playIndex = playIndex
    state.playInfo.playerPlayIndex = playerPlayIndex

    global.state_event.playInfoChanged({ ...state.playInfo })
  },
  setPlayListId(playerListId: string | null) {
    state.playInfo.playerListId = playerListId

    global.state_event.playInfoChanged({ ...state.playInfo })
  },
  setPlayMusicInfo(listId: string | null, musicInfo: LX.Download.ListItem | LX.Music.MusicInfo | null, isTempPlay: boolean = false) {
    state.playMusicInfo = { listId, musicInfo, isTempPlay }

    global.state_event.playMusicInfoChanged(state.playMusicInfo)
  },
  setMusicInfo(_musicInfo: Partial<LX.Player.MusicInfo>) {
    for (const key of musicInfoKeys) {
      const val = _musicInfo[key]
      if (val !== undefined) {
        // @ts-expect-error
        state.musicInfo[key] = val
      }
    }

    global.state_event.playerMusicInfoChanged({ ...state.musicInfo })
  },
  setIsPlay(isPlay: boolean) {
    state.isPlay = isPlay

    global.state_event.playStateChanged(isPlay)
  },
  setStatusText(statusText: string) {
    state.statusText = statusText
    global.state_event.playStateTextChanged(statusText)
  },
  setNowPlayTime(time: number) {
    const max = state.progress.maxPlayTime
    // 播放器上报的位置偶尔会略微超过总长, 这里钳住, 否则进度条会画出屏幕
    const safeTime = max > 0 ? Math.min(time, max) : Math.max(0, time)
    state.progress.nowPlayTime = safeTime
    state.progress.nowPlayTimeStr = formatPlayTime2(safeTime)
    state.progress.progress = max > 0 ? clampProgress(safeTime / max) : 0

    global.state_event.playProgressChanged({ ...state.progress })
  },
  setMaxplayTime(time: number) {
    const max = Number.isFinite(time) && time > 0 ? time : 0
    state.progress.maxPlayTime = max
    state.progress.maxPlayTimeStr = formatPlayTime2(max)
    state.progress.progress = max > 0 ? clampProgress(state.progress.nowPlayTime / max) : 0

    global.state_event.playProgressChanged({ ...state.progress })
  },
  setProgress(currentTime: number, totalTime?: number) {
    const max: number = (typeof totalTime === 'number' && Number.isFinite(totalTime) && totalTime > 0)
      ? totalTime
      : (state.progress.maxPlayTime || 0)
    const safeTime = max > 0 ? Math.min(Math.max(0, currentTime), max) : Math.max(0, currentTime)
    state.progress.nowPlayTime = safeTime
    state.progress.nowPlayTimeStr = formatPlayTime2(safeTime)
    state.progress.maxPlayTime = max
    state.progress.maxPlayTimeStr = formatPlayTime2(max)
    // 原来是 nowPlayTime / currentTime, 恒等于 1, 进度条会直接拉满
    state.progress.progress = max > 0 ? clampProgress(safeTime / max) : 0

    global.state_event.playProgressChanged({ ...state.progress })
  },
  addPlayedList(info: LX.Player.PlayMusicInfo) {
    if (state.playedList.some(m => m.musicInfo.id == info.musicInfo.id)) return
    state.playedList.push(info)

    global.state_event.playPlayedListChanged({ ...state.playedList })
  },
  removePlayedList(index: number) {
    state.playedList.splice(index, 1)

    global.state_event.playPlayedListChanged({ ...state.playedList })
  },
  clearPlayedList() {
    state.playedList = []

    global.state_event.playPlayedListChanged({ ...state.playedList })
  },
  addTempPlayList(list: LX.Player.TempPlayListItem[]) {
    const topList: Array<{ listId: string | null, musicInfo: LX.Music.MusicInfo | LX.Download.ListItem }> = []
    const bottomList = list.filter(({ isTop, ...musicInfo }) => {
      if (isTop) {
        topList.push(musicInfo)
        return false
      }
      return true
    })
    if (topList.length) arrUnshift(state.tempPlayList, topList.map(({ musicInfo, listId }) => ({ musicInfo, listId, isTempPlay: true })))
    if (bottomList.length) arrPush(state.tempPlayList, bottomList.map(({ musicInfo, listId }) => ({ musicInfo, listId, isTempPlay: true })))

    global.state_event.playTempPlayListChanged({ ...state.tempPlayList })
  },
  removeTempPlayList(index: number) {
    state.tempPlayList.splice(index, 1)

    global.state_event.playTempPlayListChanged({ ...state.tempPlayList })
  },
  clearTempPlayeList() {
    state.tempPlayList = []

    global.state_event.playTempPlayListChanged({ ...state.tempPlayList })
  },
  setLoadErrorPicUrl(url: string) {
    state.loadErrorPicUrl = url
  },
  setLastLyric(lrc?: string) {
    state.lastLyric = lrc
  },
}
