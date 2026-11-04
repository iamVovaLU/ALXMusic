// 歌词等元数据的文件缓存: 跟随「缓存位置」设置, 可以选择落在 TF 卡上
import { privateStorageDirectoryPath, getExternalStoragePaths, readDir, readFile, writeFile, unlink, mkdir } from '@/utils/fs'
import settingState from '@/store/setting/state'
import { log } from '@/utils/log'

type DirItem = { path: string }

const DIR_NAME = 'alx-meta'
const LYRIC_DIR = 'lyric'

const isExternal = () => settingState.setting['player.cacheLocation'] == 'external'

export const getMetaCacheRoot = async() => {
  if (isExternal()) {
    const paths = await getExternalStoragePaths(true).catch(() => [] as string[])
    if (paths.length) return `${paths[0]}/Android/data/cn.alx.music/files/${DIR_NAME}`
  }
  return `${privateStorageDirectoryPath}/${DIR_NAME}`
}

export const getLyricCacheDir = async() => (await getMetaCacheRoot()) + '/' + LYRIC_DIR

const safeId = (id: string) => id.replace(/[^\w.-]/g, '_')

export const writeLyricFile = async(id: string, data: unknown) => {
  const dir = await getLyricCacheDir()
  await mkdir(dir).catch(() => {})
  await writeFile(`${dir}/${safeId(id)}.json`, JSON.stringify(data))
}

export const readLyricFile = async<T = unknown>(id: string): Promise<T | null> => {
  try {
    const dir = await getLyricCacheDir()
    const text = await readFile(`${dir}/${safeId(id)}.json`, 'utf8')
    if (!text) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export const removeLyricFile = async(id: string) => {
  const dir = await getLyricCacheDir()
  await unlink(`${dir}/${safeId(id)}.json`).catch(() => {})
}

export const countLyricFiles = async() => {
  const dir = await getLyricCacheDir()
  const list = await readDir(dir).catch(() => [] as DirItem[])
  return list.length
}

export const clearLyricFiles = async() => {
  const dir = await getLyricCacheDir()
  const list = await readDir(dir).catch(() => [] as DirItem[])
  let removed = 0
  for (const item of list) {
    try {
      await unlink(item.path)
      removed++
    } catch (err) {
      log.warn('[ALX] clear lyric cache failed', item.path, err)
    }
  }
  return removed
}

export const getMetaCacheDirInfo = async() => {
  const root = await getMetaCacheRoot()
  return { root, external: isExternal() }
}
