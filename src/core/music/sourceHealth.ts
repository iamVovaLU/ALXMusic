// 音源统计: 只记录每个源(平台 + 当前自定义源)的成败/耗时, 给设置页看,
// 不再参与换源决策 -- 竞速时所有源一律同时上, 不做健康度过滤/排序/冷却.
import { getData, saveData } from '@/plugins/storage'
import { log } from '@/utils/log'

const STORAGE_KEY = '@alx_source_health_v1'
const MAX_EVENTS = 40

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
          stats.set(s.key, s)
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
      consecutiveFails: 0,
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
  scheduleSave()
}

export const recordFail = (apiSource: string, source: string, ms: number, err: unknown) => {
  const st = ensure(apiSource, source)
  st.attempts++
  st.lastFailAt = Date.now()
  st.lastError = String((err as any)?.message ?? err ?? '').slice(0, 120)
  st.consecutiveFails++
  scheduleSave()
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
