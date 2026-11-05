// 音源健康统计: 记录每个源(平台 + 当前自定义源)的成败/耗时/冷却状态,
// 给「竞速换源」提供排序依据, 也给设置页提供可视化数据.
import { getData, saveData } from '@/plugins/storage'
import { log } from '@/utils/log'

const STORAGE_KEY = '@alx_source_health_v1'
const MAX_EVENTS = 40
const FAIL_THRESHOLD = 3 // 连续失败次数达到后进入冷却
const BASE_COOLDOWN = 60 * 1000
const MAX_COOLDOWN = 30 * 60 * 1000

export interface SourceStat {
  key: string
  source: string
  apiSource: string
  attempts: number
  success: number
  avgMs: number
  lastOkAt: number
  lastFailAt: number
  lastError: string
  consecutiveFails: number
  cooldownUntil: number
}

export interface HealthEvent {
  at: number
  text: string
}

const stats = new Map<string, SourceStat>()
const events: HealthEvent[] = []
let initPromise: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

export const buildKey = (apiSource: string, source: string) => `${apiSource || 'builtin'}::${source}`

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveData(STORAGE_KEY, [...stats.values()]).catch(err => {
      log.warn('[ALX] save source health failed', err)
    })
  }, 800)
}

export const initSourceHealth = async() => {
  if (initPromise) return initPromise
  initPromise = (async() => {
    try {
      const saved = await getData<SourceStat[]>(STORAGE_KEY)
      if (Array.isArray(saved)) {
        for (const s of saved) {
          if (!s || !s.key) continue
          stats.set(s.key, { ...s, cooldownUntil: 0 })
        }
      }
    } catch (err) {
      log.warn('[ALX] load source health failed', err)
    }
  })()
  return initPromise
}

const ensure = (apiSource: string, source: string): SourceStat => {
  const key = buildKey(apiSource, source)
  let st = stats.get(key)
  if (!st) {
    st = {
      key, source, apiSource,
      attempts: 0, success: 0, avgMs: 0,
      lastOkAt: 0, lastFailAt: 0, lastError: '',
      consecutiveFails: 0, cooldownUntil: 0,
    }
    stats.set(key, st)
  }
  return st
}

export const pushEvent = (text: string) => {
  events.unshift({ at: Date.now(), text })
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
}

export const getEvents = () => events.slice()

export const recordSuccess = (apiSource: string, source: string, ms: number) => {
  const st = ensure(apiSource, source)
  st.attempts++
  st.success++
  st.avgMs = st.avgMs ? Math.round(st.avgMs * 0.7 + ms * 0.3) : ms
  st.lastOkAt = Date.now()
  st.consecutiveFails = 0
  st.cooldownUntil = 0
  scheduleSave()
}

export const recordFail = (apiSource: string, source: string, ms: number, err: unknown) => {
  const st = ensure(apiSource, source)
  st.attempts++
  st.lastFailAt = Date.now()
  st.lastError = String((err as any)?.message ?? err ?? '').slice(0, 120)
  st.consecutiveFails++
  if (st.consecutiveFails >= FAIL_THRESHOLD) {
    const level = st.consecutiveFails - FAIL_THRESHOLD
    st.cooldownUntil = Date.now() + Math.min(BASE_COOLDOWN * Math.pow(2, level), MAX_COOLDOWN)
  }
  scheduleSave()
}

export const isCoolingDown = (apiSource: string, source: string) => {
  const st = stats.get(buildKey(apiSource, source))
  return !!st && st.cooldownUntil > Date.now()
}

export const getCooldownLeft = (apiSource: string, source: string) => {
  const st = stats.get(buildKey(apiSource, source))
  return st ? Math.max(0, st.cooldownUntil - Date.now()) : 0
}

// 健康分: 成功率为主, 延迟为辅; 没数据的源给 0.5 的探索分, 免得永远不试
export const healthScore = (apiSource: string, source: string) => {
  const st = stats.get(buildKey(apiSource, source))
  if (!st || !st.attempts) return 0.5
  const rate = st.success / st.attempts
  const speed = st.avgMs ? Math.min(1, 1500 / Math.max(st.avgMs, 1)) : 0.5
  return rate * 0.75 + speed * 0.25
}

export const getStats = () => [...stats.values()].sort((a, b) => b.attempts - a.attempts)

export const clearStats = async() => {
  stats.clear()
  events.length = 0
  await saveData(STORAGE_KEY, []).catch(() => {})
}

// 验证 URL 真的可播: Range 取头部, 看状态码 + content-type
export const probeAudioUrl = async(url: string, timeout = 8000): Promise<boolean> => {
  if (!/^https?:/i.test(url)) return false
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(() => controller?.abort(), timeout)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-2047' },
      signal: controller ? controller.signal : undefined,
    })
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!res) return false
    const status = res.status
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    try { (res as any).body?.cancel?.() } catch {}
    if (status !== 200 && status !== 206) return false
    if (/html|json|text\/plain/.test(ct)) return false
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
