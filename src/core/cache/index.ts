import { readDir, stat, unlink, privateStorageDirectoryPath, getExternalStoragePaths } from '@/utils/fs'
import settingState from '@/store/setting/state'
import { log } from '@/utils/log'

export const CACHE_DIR_NAME = 'TrackPlayer'

type DirItem = { path: string, isDirectory: boolean, size: number }

// 播放器真正落盘的缓存目录 (与 plugins/player 里 setCachePath 用的是同一套规则)
export const getPlayerCacheDir = async() => {
  if (settingState.setting['player.cacheLocation'] != 'external') {
    return privateStorageDirectoryPath + '/' + CACHE_DIR_NAME
  }
  const paths = await getExternalStoragePaths(true).catch(() => [] as string[])
  return paths.length ? paths[0] + '/Android/data/cn.alx.music/files/' + CACHE_DIR_NAME : ''
}

export const getDirSize = async(path: string): Promise<number> => {
  if (!path) return 0
  const info = await stat(path).catch(() => null)
  if (!info) return 0
  if (!info.isDirectory) return info.size || 0
  const list = await readDir(path).catch(() => [] as DirItem[])
  let total = 0
  for (const item of list) total += await getDirSize(item.path)
  return total
}

// 只清空 TrackPlayer 目录里面的内容, 目录本身保留.
// 路径必须落在 TrackPlayer 上, 防止误伤别的目录.
export const clearPlayerCache = async(path: string) => {
  if (!path || !path.endsWith('/' + CACHE_DIR_NAME)) throw new Error('refuse to clear: ' + path)
  const list = await readDir(path).catch(() => [] as DirItem[])
  let removed = 0
  for (const item of list) {
    try {
      await unlink(item.path)
      removed++
    } catch (err) {
      log.warn('[ALX] clear cache item failed', item.path, err)
    }
  }
  return removed
}
