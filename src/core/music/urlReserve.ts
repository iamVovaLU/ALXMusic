// 竞速备胎池: 竞速时所有源一起抢, 第一个探活通过的立刻播;
// 其余同样探活通过的链接不浪费 -- 存起来, 播放器真的播不出来时直接换下一个,
// 不用重新搜索/竞速, 也就不会因为「探活通过但播放失败」直接弹「音频加载出错」.
// 同时记录「这首歌上已经播放失败过的源」, 避免换回来反复踩同一个坑.
const TTL = 10 * 60 * 1000
const MAX_PER_MUSIC = 12

export interface ReserveEntry {
  source: string
  quality: LX.Quality
  url: string
  at: number
}

const reserves = new Map<string, ReserveEntry[]>()
const badSources = new Map<string, Set<string>>()

const musicKey = (musicInfo: LX.Music.MusicInfo | LX.Music.MusicInfoOnline) => String(musicInfo.id)

const pruneReserves = (key: string): ReserveEntry[] | null => {
  const list = reserves.get(key)
  if (!list) return null
  const now = Date.now()
  const alive = list.filter(e => now - e.at < TTL)
  if (alive.length) reserves.set(key, alive)
  else reserves.delete(key)
  return alive.length ? alive : null
}

export const saveReserve = (musicInfo: LX.Music.MusicInfo | LX.Music.MusicInfoOnline, quality: LX.Quality, url: string) => {
  const key = musicKey(musicInfo)
  const list = pruneReserves(key) ?? []
  if (list.some(e => e.source == musicInfo.source)) return
  list.push({ source: musicInfo.source, quality, url, at: Date.now() })
  if (list.length > MAX_PER_MUSIC) list.splice(0, list.length - MAX_PER_MUSIC)
  reserves.set(key, list)
}

// 取一个备用链接: 优先同音质, 其次任意音质(能播总比报错强)
export const takeReserve = (musicInfo: LX.Music.MusicInfo | LX.Music.MusicInfoOnline, quality?: LX.Quality): ReserveEntry | null => {
  const key = musicKey(musicInfo)
  const list = pruneReserves(key)
  if (!list) return null
  let index = quality ? list.findIndex(e => e.quality == quality) : -1
  if (index < 0) index = 0
  const [entry] = list.splice(index, 1)
  if (list.length) reserves.set(key, list)
  else reserves.delete(key)
  return entry
}

export const markBadSource = (musicInfo: LX.Music.MusicInfo | LX.Music.MusicInfoOnline, source: string) => {
  const key = musicKey(musicInfo)
  let set = badSources.get(key)
  if (!set) {
    set = new Set()
    badSources.set(key, set)
  }
  set.add(source)
}

export const isBadSource = (musicInfo: LX.Music.MusicInfo | LX.Music.MusicInfoOnline, source: string) => {
  return badSources.get(musicKey(musicInfo))?.has(source) ?? false
}
