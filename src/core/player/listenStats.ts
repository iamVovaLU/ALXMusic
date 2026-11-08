import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { throttle } from '@/utils/common'

/**
 * ALX: 智能随机
 * 记录每首歌的播放次数与最后播放时间, 随机模式下按权重抽取:
 * - 从没听过 -> 权重最高
 * - 很久没听 -> 权重随时间增长
 * - 最近反复听 -> 权重被压低
 * 这样随机模式会主动往 "冷门/久未播放" 的方向偏, 而不是均匀撒点.
 */

const STORAGE_KEY = storageDataPrefix.listenStats
// 统计表最多保留多少首, 超出丢弃最久没播的
const MAX_ENTRIES = 20000
const DAY_MS = 24 * 60 * 60 * 1000
// 同曲重复触发 play 事件(暂停后继续)时的去重窗口
const RECORD_DEDUPE_MS = 30 * 60 * 1000

interface ListenStat {
  /** 播放次数 */
  n: number
  /** 最后播放时间戳 */
  t: number
}

type ListenStatMap = Record<string, ListenStat>

let statMap: ListenStatMap | null = null
let loadPromise: Promise<ListenStatMap> | null = null
let lastRecordId: string | null = null
let lastRecordAt = 0

const prune = (map: ListenStatMap) => {
  const ids = Object.keys(map)
  if (ids.length <= MAX_ENTRIES) return
  ids.sort((a, b) => map[a].t - map[b].t)
  for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete map[id]
}

const saveThrottle = throttle(() => {
  if (!statMap) return
  prune(statMap)
  void saveData(STORAGE_KEY, statMap)
}, 5000)

export const initListenStats = async(): Promise<ListenStatMap> => {
  if (loadPromise) return loadPromise
  loadPromise = (async() => {
    try {
      const data = await getData<ListenStatMap>(STORAGE_KEY)
      // 兼容异常数据, 只保留合法条目
      const map: ListenStatMap = {}
      if (data && typeof data == 'object') {
        for (const id of Object.keys(data)) {
          const item = data[id]
          if (!item || typeof item.n != 'number' || typeof item.t != 'number') continue
          map[id] = { n: item.n, t: item.t }
        }
      }
      statMap = map
    } catch {
      statMap = {}
    }
    return statMap
  })()
  return loadPromise
}

/**
 * 记录一次播放(歌曲真正开始播放时调用)
 */
export const recordListen = (musicInfo?: { id?: string | null } | null) => {
  const id = musicInfo?.id
  if (!id) return
  const now = Date.now()
  // 暂停后继续 / 单曲循环会反复触发 play 事件, 这里做去重
  if (lastRecordId == id && now - lastRecordAt < RECORD_DEDUPE_MS) return
  lastRecordId = id
  lastRecordAt = now

  void initListenStats().then((map) => {
    const item = map[id] ?? (map[id] = { n: 0, t: 0 })
    item.n += 1
    item.t = now
    saveThrottle()
  })
}

/**
 * 取单曲权重, 越大越容易被抽中
 */
const getWeight = (id: string, now: number) => {
  const item = statMap?.[id]
  if (!item?.n) return 8 // 从没听过
  const days = Math.max(0, (now - item.t) / DAY_MS)
  // 越久没听权重越高, 365 天封顶 (1 ~ 13.2)
  const recency = 1 + Math.min(days, 365) / 30
  // 听得越多权重越低, 对数级压缩 (n=100 时约 5.65)
  const freq = 1 + Math.log2(1 + item.n) * 0.7
  // 最低保留 0.8: 再常听的歌也会偶尔冒头, 不会彻底消失
  return Math.max(0.8, recency / freq)
}

/**
 * 智能随机抽取下标, 返回 -1 表示列表为空
 * @param list 候选歌曲(已过滤掉本轮播放过的)
 * @param excludeId 需要排除的歌曲 id(通常是当前正在播的)
 */
export const pickSmartRandomIndex = (list: Array<{ id: string }>, excludeId?: string | null): number => {
  if (!list.length) return -1
  // 统计还没加载好时退回均等随机, 不阻塞播放
  if (!statMap) {
    void initListenStats()
    return Math.floor(Math.random() * list.length)
  }

  const now = Date.now()
  const weights = new Array<number>(list.length)
  let total = 0
  for (let i = 0; i < list.length; i++) {
    const id = list[i].id
    const weight = id === excludeId ? 0 : getWeight(id, now)
    weights[i] = weight
    total += weight
  }
  if (total <= 0) return Math.floor(Math.random() * list.length)

  let remain = Math.random() * total
  for (let i = 0; i < list.length; i++) {
    remain -= weights[i]
    if (remain < 0) return i
  }
  return list.length - 1
}

/**
 * 调试用: 取某首歌的统计
 */
export const getListenStat = (id: string): ListenStat | undefined => statMap?.[id]
