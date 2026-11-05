// if (targetSong.key) { // 如果是已下载的歌曲
//   const filePath = path.join(appSetting['download.savePath'], targetSong.metadata.fileName)
//   // console.log(filePath)

import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import {
  getMusicUrl as getDownloadMusicUrl,
  getPicUrl as getDownloadPicUrl,
  getLyricInfo as getDownloadLyricInfo,
} from './download'
import {
  getMusicUrl as getLocalMusicUrl,
  getPicUrl as getLocalPicUrl,
  getLyricInfo as getLocalLyricInfo,
} from './local'
import { getMusicUrlFromAllSources, getPlayQuality } from './utils'
import { saveMusicUrl, getMusicUrl as getStoredMusicUrl } from '@/utils/data'
import { isCached } from '@/plugins/player/utils'
import settingState from '@/store/setting/state'
import { getFilePath as getDownloadedFilePath } from '@/core/download'
import { existsFile } from '@/utils/fs'
import { log } from '@/utils/log'


export const getMusicUrl = async({
  musicInfo,
  quality,
  isRefresh = false,
  onToggleSource,
  allowToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  quality?: LX.Quality
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
}): Promise<string> => {
  if ('progress' in musicInfo) {
    return getDownloadMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
  } else {
    // ALXMusic: 优先播放已下载的文件
    const downloadedPath = getDownloadedFilePath(musicInfo)
    if (downloadedPath) {
      try {
        if (await existsFile(downloadedPath)) {
          return downloadedPath
        }
      } catch (err) {
        log.warn('[ALX] check downloaded file failed', err)
      }
    }
    return getOnlineMusicUrl({ musicInfo, isRefresh, quality, onToggleSource, allowToggleSource }).catch(async err => {
      // 断网兜底: 有历史链接就先播着(缓存优先), 实在没有再把错误抛上去走换源流程
      const storedUrl = await getCachedMusicUrl(musicInfo as LX.Music.MusicInfoOnline, false)
      if (storedUrl) return storedUrl
      throw err
    })
  }
}


/**
 * ALX: 缓存优先 -- 这首歌之前取过的链接如果已经整段缓存下来, 直接用它回放, 完全不联网.
 * 关键点: 全源竞速每次都会重新取链接, 不同源/不同 CDN 的 URL 不一样, 缓存永远打不中;
 * 所以要优先复用"当初被缓存的那条 URL", 断网时才有歌可听.
 * @param requireCached true 时只接受确实在缓存里的 URL(离线可播), false 时只要存过就返回(兜底)
 */
const getCachedMusicUrl = async(musicInfo: LX.Music.MusicInfoOnline, requireCached: boolean): Promise<string> => {
  const qualitys = new Set<LX.Quality>()
  qualitys.add(getPlayQuality(settingState.setting['player.playQuality'], musicInfo))
  const all = musicInfo.meta?._qualitys
  if (all) for (const q of Object.keys(all)) qualitys.add(q as LX.Quality)
  for (const q of qualitys) {
    const url = await getStoredMusicUrl(musicInfo, q).catch(() => '')
    if (!url) continue
    if (!requireCached) return url
    if (await isCached(url).catch(() => false)) return url
  }
  return ''
}

/**
 * 全源竞速取链接: 当前源 + 所有匹配到的其他源同时上, 先到先得 (设置可关)
 * 缓存优先: 已缓存的链接直接复用(离线可播), 没有再联网竞速
 */
export const getMusicUrlRacing = async({
  musicInfo,
  quality,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  quality?: LX.Quality
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  const info = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
  if (info.source == 'local') {
    return getLocalMusicUrl({ musicInfo: info as LX.Music.MusicInfoLocal, isRefresh: false, onToggleSource })
  }
  const downloadedPath = getDownloadedFilePath(info as LX.Music.MusicInfo)
  if (downloadedPath) {
    try {
      if (await existsFile(downloadedPath)) {
        return downloadedPath
      }
    } catch (err) {
      log.warn('[ALX] check downloaded file failed', err)
    }
  }
  // 缓存优先: 已缓存过的链接直接回放, 不联网(离线可用, 也避免每次换 URL 导致缓存失效)
  const cachedUrl = await getCachedMusicUrl(info as LX.Music.MusicInfoOnline, true)
  if (cachedUrl) return cachedUrl
  try {
    const result = await getMusicUrlFromAllSources({
      musicInfo: info as LX.Music.MusicInfoOnline,
      quality,
      onToggleSource,
    })
    void saveMusicUrl(result.musicInfo, result.quality, result.url)
    return result.url
  } catch (err) {
    // 断网兜底: 只要存过链接就试着播(缓存里可能还有可用的片段)
    const storedUrl = await getCachedMusicUrl(info as LX.Music.MusicInfoOnline, false)
    if (storedUrl) return storedUrl
    throw err
  }
}

export const getPicPath = async({
  musicInfo,
  isRefresh = false,
  listId,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  listId?: string | null
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if ('progress' in musicInfo) {
    return getDownloadPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else {
    return getOnlinePicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  }
}

export const getLyricInfo = async({
  musicInfo,
  isRefresh = false,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if ('progress' in musicInfo) {
    return getDownloadLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else {
    return getOnlineLyricInfo({ musicInfo, isRefresh, onToggleSource })
  }
}
