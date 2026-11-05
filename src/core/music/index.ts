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
import { getMusicUrlFromAllSources } from './utils'
import { saveMusicUrl } from '@/utils/data'
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
    return getOnlineMusicUrl({ musicInfo, isRefresh, quality, onToggleSource, allowToggleSource })
  }
}

/**
 * 全源竞速取链接: 当前源 + 所有匹配到的其他源同时上, 先到先得 (设置可关)
 * 不走 URL 缓存, 保证每次都是新鲜的链接
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
  const result = await getMusicUrlFromAllSources({
    musicInfo: info as LX.Music.MusicInfoOnline,
    quality,
    onToggleSource,
  })
  void saveMusicUrl(result.musicInfo, result.quality, result.url)
  return result.url
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
