// 听歌统计: 记录每首歌的累计收听时长(秒), 以及按歌手/专辑聚合的排行榜
import { getData, saveData } from '@/plugins/storage'
import playerState from '@/store/player/state'
import { log } from '@/utils/log'

const STORAGE_KEY = '@alx_l…s_v2'
const TICK_MS = 10000 // 每 10 秒落一次账, 被杀进程最多丢 10 秒
const MAX_TICK_SECONDS = 300 // 单次最多记 5 分钟, 防止挂后台瞎涨

export interface SongStat {
  id: string
  name: string
  singer: string
  album: string
  seconds: number
  lastAt: number
}

export interface RankItem {
  key: string
  name: string
  sub: string
  seconds: number
  songs: number
}

const stats = new Map<string, SongStat>()
let initPromise: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let lastTickAt = 0

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveData(STORAGE_KEY, [...stats.values()]).catch(err => {
      log.warn('[ALX] save listen stats failed', err)
    })
  }, 1000)
}

// 把「从现在到上次记账」的时间加到当前歌曲上
const flush = () => {
  if (!lastTickAt) return
  const now = Date.now()
  let delta = Math.round((now - lastTickAt) / 1000)
  lastTickAt = now
  if (delta <= 0) return
  if (delta > MAX_TICK_SECONDS) delta = MAX_TICK_SECONDS
  const info = playerState.musicInfo
  const id = info.id
  if (!id) return
  const existed = stats.get(id)
  if (existed) {
    existed.seconds += delta
    existed.lastAt = now
    if (info.name) existed.name = info.name
    if (info.singer) existed.singer = info.singer
    if (info.album) existed.album = info.album
  } else {
    stats.set(id, {
      id,
      name: info.name || '(未知歌曲)',
      singer: info.singer || '',
      album: info.album || '',
      seconds: delta,
      lastAt: now,
    })
  }
  scheduleSave()
}

const startTick = () => {
  if (tickTimer) return
  tickTimer = setInterval(flush, TICK_MS)
}

const stopTick = () => {
  if (!tickTimer) return
  clearInterval(tickTimer)
  tickTimer = null
}

export const initListenStats = async() => {
  if (initPromise) return initPromise
  initPromise = (async() => {
    try {
      const saved = await getData<SongStat[]>(STORAGE_KEY)
      if (Array.isArray(saved)) {
        for (const item of saved) {
          if (item && item.id) stats.set(item.id, { ...item, seconds: item.seconds || 0 })
        }
      }
    } catch (err) {
      log.warn('[ALX] load listen stats failed', err)
    }

    // 播放/暂停/切歌 时结算
    global.app_event.on('play', () => {
      lastTickAt = Date.now()
      startTick()
    })
    global.app_event.on('pause', () => {
      flush()
      stopTick()
    })
    global.app_event.on('musicToggled', () => {
      flush()
      lastTickAt = playerState.isPlay ? Date.now() : 0
    })
  })()
  return initPromise
}

const splitSingers = (singer: string) => singer.split(/[\/、,&]| feat\.? /i).map(s => s.trim()).filter(Boolean)

export const getTopSongs = (limit = 100): RankItem[] => {
  return [...stats.values()]
    .filter(item => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || b.lastAt - a.lastAt)
    .slice(0, limit)
    .map(item => ({
      key: item.id,
      name: item.name,
      sub: [item.singer, item.album].filter(Boolean).join(' · '),
      seconds: item.seconds,
      songs: 1,
    }))
}

export const getTopSingers = (limit = 100): RankItem[] => {
  const agg = new Map<string, RankItem & { ids: Set<string> }>()
  for (const item of stats.values()) {
    if (item.seconds <= 0) continue
    const singers = splitSingers(item.singer)
    if (!singers.length) continue
    for (const singer of singers) {
      let row = agg.get(singer)
      if (!row) {
        row = { key: singer, name: singer, sub: '', seconds: 0, songs: 0, ids: new Set() }
        agg.set(singer, row)
      }
      row.seconds += item.seconds
      row.ids.add(item.id)
    }
  }
  return [...agg.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, limit)
    .map(({ ids, ...row }) => ({ ...row, songs: ids.size }))
}

export const getTopAlbums = (limit = 100): RankItem[] => {
  const agg = new Map<string, RankItem & { ids: Set<string>, singers: Set<string> }>()
  for (const item of stats.values()) {
    if (item.seconds <= 0) continue
    const album = item.album.trim() || '未知专辑'
    let row = agg.get(album)
    if (!row) {
      row = { key: album, name: album, sub: '', seconds: 0, songs: 0, ids: new Set(), singers: new Set() }
      agg.set(album, row)
    }
    row.seconds += item.seconds
    row.ids.add(item.id)
    if (item.singer) row.singers.add(item.singer)
  }
  return [...agg.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, limit)
    .map(({ ids, singers, ...row }) => ({
      ...row,
      songs: ids.size,
      sub: [...singers].slice(0, 2).join(' / '),
    }))
}

export const getListenSummary = () => {
  let seconds = 0
  for (const item of stats.values()) seconds += item.seconds
  return { songs: stats.size, seconds }
}

export const clearListenStats = async() => {
  stats.clear()
  await saveData(STORAGE_KEY, []).catch(() => {})
}

// 秒 -> 中文时长 (以分钟为主)
export const formatDuration = (seconds: number) => {
  const totalMinutes = Math.floor(seconds / 60)
  if (totalMinutes < 1) return `${Math.round(seconds)} 秒`
  if (totalMinutes < 60) return `${totalMinutes} 分钟`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
}
