// 听歌统计: 记录每首歌的累计收听时长(秒), 以及按歌手/专辑聚合的排行榜
import { getData, saveData } from '@/plugins/storage'
import playerState from '@/store/player/state'
import { log } from '@/utils/log'
import BackgroundTimer from 'react-native-background-timer'

const STORAGE_KEY = '@alx_listen_stats_v3'
// 旧版(只有歌曲累计)的存储键, 首次升级时迁过来
const LEGACY_STORAGE_KEYS = ['@alx_listen_stats_v2', '@alx_l…s_v2']
const TICK_MS = 10000 // 每 10 秒落一次账, 被杀进程最多丢 10 秒
const MAX_TICK_SECONDS = 300 // 单次最多记 5 分钟, 防止挂后台瞎涨
// 每日统计: 总时长留 366 天, 单日歌曲明细只留最近 60 天(再久的只留总数)
const KEEP_DAYS = 366
const KEEP_SONG_DAYS = 60
const MAX_SONGS_PER_DAY = 300

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

// 单日记录: t = 当天总秒数, songs = 当天每首歌的秒数(过期会被裁掉)
interface DayStat {
  t: number
  songs?: Record<string, number>
}

export interface DayPoint {
  date: string
  seconds: number
}

const stats = new Map<string, SongStat>()
const daily: Record<string, DayStat> = {}
let initPromise: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: number | null = null
let lastTickAt = 0
// 计时开始时记下的那首歌 (切歌时 playerState 已经变成新歌了, 不能现取)
let active: { id: string, name: string, singer: string, album: string } | null = null

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    pruneDaily()
    void saveData(STORAGE_KEY, { songs: [...stats.values()], daily }).catch(err => {
      log.warn('[ALX] save listen stats failed', err)
    })
  }, 1000)
}

const pad2 = (num: number) => num < 10 ? '0' + num : String(num)
const dateKeyOf = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const pruneDaily = () => {
  const keys = Object.keys(daily).sort()
  while (keys.length > KEEP_DAYS) {
    const key = keys.shift()
    if (key) delete daily[key]
  }
  const now = Date.now()
  for (const key of keys) {
    const day = daily[key]
    if (!day) continue
    if (day.songs) {
      const ageDays = (now - new Date(key + 'T00:00:00').getTime()) / 86400000
      if (ageDays > KEEP_SONG_DAYS) {
        delete day.songs
        continue
      }
      const ids = Object.keys(day.songs)
      if (ids.length > MAX_SONGS_PER_DAY) {
        ids.sort((a, b) => day.songs![a] - day.songs![b])
        for (const id of ids.slice(0, ids.length - MAX_SONGS_PER_DAY)) delete day.songs![id]
      }
    }
  }
}

const snapshot = () => {
  const info = playerState.musicInfo
  if (!info.id) return null
  return {
    id: String(info.id),
    name: info.name || '',
    singer: info.singer || '',
    album: info.album || '',
  }
}

// 把「从现在到上次记账」的时间加给**开始计时时那首歌** (active), 而不是当前正在播的
const flush = () => {
  const now = Date.now()
  // 没在播放: 清掉基准, 恢复播放时重新起算(暂停期间不记账)
  if (!playerState.isPlay) {
    lastTickAt = 0
    return
  }
  if (!active) active = snapshot()
  if (!active) return
  // 自愈: 单曲循环时 play 事件可能被 URL 获取流程吞掉, 这里以"正在播放"为准重新起算
  if (!lastTickAt) {
    lastTickAt = now
    return
  }
  let delta = Math.round((now - lastTickAt) / 1000)
  lastTickAt = now
  if (delta <= 0) return
  if (delta > MAX_TICK_SECONDS) delta = MAX_TICK_SECONDS
  const existed = stats.get(active.id)
  if (existed) {
    existed.seconds += delta
    existed.lastAt = now
    if (active.name) existed.name = active.name
    if (active.singer) existed.singer = active.singer
    if (active.album) existed.album = active.album
  } else {
    stats.set(active.id, {
      id: active.id,
      name: active.name || '(未知歌曲)',
      singer: active.singer,
      album: active.album,
      seconds: delta,
      lastAt: now,
    })
  }
  scheduleSave()

  // 每日统计: 总时长 + 当天每首歌的明细
  const dayKey = dateKeyOf(now)
  let day = daily[dayKey]
  if (!day) day = daily[dayKey] = { t: 0, songs: {} }
  day.t += delta
  const daySongs = day.songs ?? (day.songs = {})
  daySongs[active.id] = (daySongs[active.id] ?? 0) + delta
}

// 用 BackgroundTimer: 普通 setInterval 在后台/息屏时会被系统挂起, 导致听歌时长停记
const startTick = () => {
  if (tickTimer) return
  tickTimer = BackgroundTimer.setInterval(flush, TICK_MS)
}

export const initListenStats = async() => {
  if (initPromise) return initPromise
  initPromise = (async() => {
    const loadSongs = (saved: SongStat[] | null | undefined) => {
      if (!Array.isArray(saved)) return
      for (const item of saved) {
        if (item && item.id) stats.set(item.id, { ...item, seconds: item.seconds || 0 })
      }
    }
    try {
      const saved = await getData<{ songs?: SongStat[], daily?: Record<string, DayStat> }>(STORAGE_KEY)
      if (saved && typeof saved == 'object') {
        loadSongs(saved.songs)
        if (saved.daily && typeof saved.daily == 'object') {
          for (const key of Object.keys(saved.daily)) {
            const day = saved.daily[key]
            if (!day || typeof day.t != 'number') continue
            daily[key] = {
              t: day.t,
              songs: day.songs && typeof day.songs == 'object' ? { ...day.songs } : undefined,
            }
          }
        }
      } else {
        // 旧版只有歌曲累计, 迁一次
        for (const key of LEGACY_STORAGE_KEYS) {
          const legacy = await getData<SongStat[]>(key).catch(() => null)
          if (Array.isArray(legacy) && legacy.length) {
            loadSongs(legacy)
            break
          }
        }
      }
    } catch (err) {
      log.warn('[ALX] load listen stats failed', err)
    }

    // 计时器常驻, 由 flush 自己判断是否在播放 (被吞掉的 play 事件也能自愈)
    startTick()

    // 播放/暂停/切歌 时结算
    global.app_event.on('play', () => {
      // 恢复播放时 active 还是同一首歌; 首次播放则取当前歌曲
      active = active ?? snapshot()
      if (!lastTickAt) lastTickAt = Date.now()
      startTick()
    })
    global.app_event.on('pause', () => {
      flush()
      lastTickAt = 0
    })
    global.app_event.on('musicToggled', () => {
      // 先把时间结算给上一首歌 (active), 再切到新歌
      flush()
      active = snapshot()
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
  for (const key of Object.keys(daily)) delete daily[key]
  await saveData(STORAGE_KEY, { songs: [], daily: {} }).catch(() => {})
}

/**
 * 最近 N 天的每日收听总时长, 升序(最后一个是今天), 没记录的日期补 0
 */
export const getDailySeries = (days = 7): DayPoint[] => {
  const result: DayPoint[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const ts = today.getTime() - i * 86400000
    const key = dateKeyOf(ts)
    result.push({ date: key, seconds: Math.round(daily[key]?.t ?? 0) })
  }
  return result
}

/**
 * 某一天的明细: 总时长 + 当天听过的歌(按时长降序)
 */
export const getDayDetail = (date: string) => {
  const day = daily[date]
  const songs: RankItem[] = []
  if (day?.songs) {
    for (const id of Object.keys(day.songs)) {
      const seconds = Math.round(day.songs[id])
      if (seconds <= 0) continue
      const info = stats.get(id)
      songs.push({
        key: id,
        name: info?.name || '(未知歌曲)',
        sub: [info?.singer, info?.album].filter(Boolean).join(' · '),
        seconds,
        songs: 1,
      })
    }
    songs.sort((a, b) => b.seconds - a.seconds)
  }
  return { seconds: Math.round(day?.t ?? 0), songs, hasDetail: !!day?.songs }
}

/** 今天 / 近 7 天 / 近 30 天的总时长 */
export const getDailySummary = () => {
  const series30 = getDailySeries(30)
  const week = series30.slice(-7).reduce((sum, item) => sum + item.seconds, 0)
  const month = series30.reduce((sum, item) => sum + item.seconds, 0)
  return { today: series30[series30.length - 1]?.seconds ?? 0, week, month }
}

/** 日期 key -> 月-日 */
export const formatDayShort = (date: string) => date.slice(5)

/** 日期 key -> 周几 */
export const formatDayWeek = (date: string) => {
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return week[new Date(date + 'T00:00:00').getDay()] ?? ''
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
