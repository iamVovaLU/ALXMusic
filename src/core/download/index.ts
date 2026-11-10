import RNFS from 'react-native-fs'
import { getMusicUrl as getOnlineMusicUrl } from '@/core/music/online'
import { cp, stat, unlink, existsFile, readDir, privateStorageDirectoryPath, temporaryDirectoryPath, mkdir, externalStorageDirectoryPath, writeFile } from '@/utils/fs'
import { getData, saveData } from '@/plugins/storage'
import settingState from '@/store/setting/state'
import { log } from '@/utils/log'
import { toast, checkStoragePermissions, requestStoragePermission } from '@/utils/tools'

// ALXMusic download manager.
// NOTE: keep this module free of imports from '@/core/music' (circular imports).

const STORAGE_KEY = '@alx_download_list_v1'
const TEMP_DIR = temporaryDirectoryPath + '/alx_download'
const DEFAULT_CONCURRENCY = 2
const MAX_CONCURRENCY = 6
// 失败自动重试次数 + 每次重试前的等待(毫秒)
const MAX_RETRY = 3
const RETRY_DELAYS = [2000, 5000, 15000]

type Listener = (list: LX.Download.ListItem[]) => void

let tasks: LX.Download.ListItem[] = []
const listeners = new Set<Listener>()
const running = new Map<string, { jobId: number }>()
let initPromise: Promise<void> | null = null

const isContentUri = (path: string) => path.startsWith('content://')
// "content://.../tree/primary%3ADownload/xxx.mp3" 这种把文件名拼在 tree URI 后面的路径,
// Android 的 DocumentFile.fromTreeUri() 会忽略末尾那段, 直接指回目录本身。
// 拿它去 unlink 会递归清空整个目录 (血的教训: 整个 Download 目录被删光)。
const isTreePath = (path: string) => isContentUri(path) && path.includes('/tree/') && !path.includes('/document/')

const emit = () => {
  const snapshot = tasks.map(t => ({ ...t }))
  listeners.forEach(listener => {
    try {
      listener(snapshot)
    } catch (err) {
      log.error('[ALX] download listener error', err)
    }
  })
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
const persist = () => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    const data = tasks.map(t => ({
      ...t,
      speed: '',
      status: t.status == 'run' ? 'pause' : t.status,
      statusText: t.status == 'run' ? '' : t.statusText,
    }))
    void saveData(STORAGE_KEY, data).catch(err => {
      log.error('[ALX] save download list failed', err)
    })
  }, 300)
}

const ensureDir = async(dir: string) => {
  try {
    const info = await stat(dir)
    if (info.isDirectory) return
  } catch {}
  await mkdir(dir)
}

const sanitizeFileName = (name: string) => {
  let result = name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (result.length > 120) result = result.substring(0, 120)
  return result || 'unknown'
}

const getUrlExt = (url: string) => {
  try {
    const path = url.split('?')[0].split('#')[0]
    const index = path.lastIndexOf('.')
    if (index < 0) return 'mp3'
    const ext = path.substring(index + 1).toLowerCase()
    return ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'ape'].includes(ext) ? ext : 'mp3'
  } catch {
    return 'mp3'
  }
}

const buildFileName = (musicInfo: LX.Music.MusicInfoOnline, ext: string) => {
  const template = settingState.setting['download.fileName']
  let name = ''
  switch (template) {
    case '歌手 - 歌名':
      name = `${musicInfo.singer || '未知歌手'} - ${musicInfo.name}`
      break
    case '歌名':
      name = musicInfo.name
      break
    case '歌名 - 歌手':
    default:
      name = `${musicInfo.name} - ${musicInfo.singer || '未知歌手'}`
      break
  }
  return sanitizeFileName(name) + '.' + ext
}

// 默认下载到系统公共下载目录: /storage/emulated/0/Download/ALXMusic
const DEFAULT_DOWNLOAD_DIR = externalStorageDirectoryPath + '/Download/ALXMusic'

// 公共目录不一定可写 (Android 11+ 分区存储), 用一次真实写入探测
const canWriteDir = async(dir: string) => {
  const probe = dir + '/.alx_write_test'
  try {
    await writeFile(probe, 'ok')
    await unlink(probe).catch(() => {})
    return true
  } catch {
    return false
  }
}

const getDefaultDownloadDir = async() => {
  try {
    let granted = await checkStoragePermissions()
    if (!granted) granted = !!(await requestStoragePermission())
    if (!granted) return ''
    await ensureDir(DEFAULT_DOWNLOAD_DIR)
    if (await canWriteDir(DEFAULT_DOWNLOAD_DIR)) return DEFAULT_DOWNLOAD_DIR
  } catch (err) {
    log.warn('[ALX] public download dir unavailable', err)
  }
  return ''
}

let fallbackNoticeShown = false

const getTargetPath = async(fileName: string) => {
  const savePath = settingState.setting['download.savePath']
  if (savePath) return savePath + '/' + fileName
  const publicDir = await getDefaultDownloadDir()
  if (publicDir) return publicDir + '/' + fileName
  if (!fallbackNoticeShown) {
    fallbackNoticeShown = true
    log.warn('[ALX] fallback to private download dir')
    toast('系统下载目录不可写，已改用应用内目录')
  }
  const dir = privateStorageDirectoryPath + '/ALXMusic/Download'
  await ensureDir(dir)
  return dir + '/' + fileName
}

const removeFile = async(path: string) => {
  try {
    let target = path
    if (isTreePath(path)) {
      // 先在目录里按名字找到真正的 document URI, 绝不能用 tree 根
      const index = path.lastIndexOf('/')
      const parent = path.substring(0, index)
      const name = path.substring(index + 1)
      if (!name) return
      const list = await readDir(parent).catch(() => null)
      const hit = list?.find(item => item.name == name)
      if (!hit) return
      target = hit.path
    }
    const info = await stat(target).catch(() => null)
    if (!info) return
    // 最后一道保险: 目录一律不动
    if (info.isDirectory) {
      log.warn('[ALX] refuse to remove directory', target)
      return
    }
    if (isContentUri(target)) await unlink(target)
    else if (await RNFS.exists(target)) await RNFS.unlink(target)
  } catch (err) {
    log.warn('[ALX] remove file failed', path, err)
  }
}

const updateTask = (task: LX.Download.ListItem, data: Partial<LX.Download.ListItem>) => {
  Object.assign(task, data)
  emit()
  persist()
}

const getConcurrency = () => {
  const value = settingState.setting['download.maxConcurrent']
  if (typeof value != 'number' || Number.isNaN(value)) return DEFAULT_CONCURRENCY
  return Math.min(Math.max(Math.floor(value), 1), MAX_CONCURRENCY)
}

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) })

const startNext = () => {
  const concurrency = getConcurrency()
  if (running.size >= concurrency) return
  const waiting = tasks.filter(t => t.status == 'waiting')
  for (const task of waiting) {
    if (running.size >= concurrency) break
    if (running.has(task.id)) continue
    void runTask(task)
  }
}

// 单次下载尝试: 取链接 -> 下到临时文件 -> 复制到目标目录. 失败直接抛出, 由 runTask 决定是否重试
const downloadOnce = async(task: LX.Download.ListItem, attempt: number) => {
  updateTask(task, {
    status: 'run',
    statusText: global.i18n.t('alx_download_getting_url'),
    downloaded: 0,
    total: 0,
    progress: 0,
    speed: '',
  })

  let tempFile = ''
  try {
    // 重试时丢掉上一次可能已失效的链接, 重新取
    if (attempt > 0) task.metadata.url = null
    const url = task.metadata.url ?? await getOnlineMusicUrl({
      musicInfo: task.metadata.musicInfo,
      isRefresh: true,
    })
    if (!url) throw new Error('empty url')
    task.metadata.url = url
    const ext = getUrlExt(url)
    task.metadata.ext = ext as LX.Download.FileExt
    const fileName = buildFileName(task.metadata.musicInfo, ext)
    task.metadata.fileName = fileName
    updateTask(task, { statusText: global.i18n.t('alx_download_downloading') })

    await ensureDir(TEMP_DIR)
    tempFile = TEMP_DIR + '/' + task.id.replace(/[^\w.-]/g, '_') + '.' + ext
    await removeFile(tempFile)

    let lastEmit = 0
    let lastBytes = 0
    let lastTime = Date.now()
    const { jobId, promise } = RNFS.downloadFile({
      fromUrl: url,
      toFile: tempFile,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36',
      },
      progressInterval: 500,
      progress: res => {
        if (task.status != 'run') return
        const now = Date.now()
        if (now - lastEmit < 500) return
        lastEmit = now
        const total = res.contentLength > 0 ? res.contentLength : 0
        const progress = total > 0 ? res.bytesWritten / total : 0
        const deltaBytes = res.bytesWritten - lastBytes
        const deltaTime = now - lastTime
        lastBytes = res.bytesWritten
        lastTime = now
        updateTask(task, {
          downloaded: res.bytesWritten,
          total,
          progress,
          speed: total > 0 && deltaTime > 0 ? (deltaBytes / 1024 / (deltaTime / 1000)).toFixed(0) + ' KB/s' : '',
        })
      },
    })
    running.set(task.id, { jobId })
    const result = await promise
    if (result.statusCode && result.statusCode >= 400) {
      const err: any = new Error('HTTP ' + result.statusCode)
      // 4xx 里除了超时/限流基本都是死链, 重试没意义
      err.noRetry = result.statusCode < 500 && ![408, 425, 429].includes(result.statusCode)
      throw err
    }
    if (task.status != 'run') throw new Error('paused')

    const target = await getTargetPath(fileName)
    if (await existsFile(target)) await removeFile(target)
    if (isContentUri(target)) {
      await cp(tempFile, target)
      await removeFile(tempFile)
    } else {
      // 公共下载目录和 cache 是不同文件系统, moveFile(rename) 会失败, 用复制
      await cp(tempFile, target)
      await removeFile(tempFile)
    }
    tempFile = ''

    updateTask(task, {
      isComplate: true,
      status: 'completed',
      statusText: global.i18n.t('alx_download_completed'),
      progress: 1,
      speed: '',
      metadata: { ...task.metadata, filePath: target },
    })
    log.info('[ALX] download completed', task.id, target)
  } finally {
    if (tempFile) void removeFile(tempFile)
  }
}

const runTask = async(task: LX.Download.ListItem) => {
  if (running.has(task.id)) return
  // 占位: 重试等待期间也算法在跑, 防止 startNext 重复调度同一首
  running.set(task.id, { jobId: 0 })
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await downloadOnce(task, attempt)
        return
      } catch (err: any) {
        // 暂停/被移除时不算失败, 也不重试
        if (task.status != 'run') return
        if (err?.noRetry || attempt >= MAX_RETRY) throw err
        log.warn('[ALX] download attempt failed, will retry', task.id, attempt + 1, err?.message ?? err)
        updateTask(task, {
          statusText: global.i18n.t('alx_download_retry', { num: attempt + 1, max: MAX_RETRY }),
          speed: '',
        })
        await sleep(RETRY_DELAYS[attempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1])
        if (task.status != 'run') return
      }
    }
  } catch (err: any) {
    log.error('[ALX] download failed', task.id, err?.message ?? err)
    if (task.status != 'pause') {
      updateTask(task, {
        status: 'error',
        statusText: err?.message ?? 'error',
        speed: '',
      })
    }
  } finally {
    running.delete(task.id)
    emit()
    persist()
    startNext()
  }
}

export const init = async() => {
  if (initPromise) return initPromise
  initPromise = (async() => {
    let saved: LX.Download.ListItem[] | null = null
    try {
      saved = await getData<LX.Download.ListItem[]>(STORAGE_KEY)
    } catch (err) {
      log.error('[ALX] load download list failed', err)
    }
    if (saved && Array.isArray(saved)) {
      tasks = saved.map(t => ({
        ...t,
        status: t.status == 'run' ? 'pause' : t.status,
        speed: '',
        statusText: t.status == 'run' ? '' : t.statusText,
      }))
    }
    emit()
  })()
  return initPromise
}

export const subscribe = (listener: Listener) => {
  listeners.add(listener)
  listener(tasks.map(t => ({ ...t })))
  return () => { listeners.delete(listener) }
}

export const getList = () => tasks.map(t => ({ ...t }))

export const getFilePath = (musicInfo: { id: string }) => {
  const task = tasks.find(t => t.id == musicInfo.id && t.isComplate)
  return task?.metadata.filePath ?? ''
}

export const getDownloadedTask = (musicInfo: { id: string }) => tasks.find(t => t.id == musicInfo.id)

export const addTasks = async(musicInfos: LX.Music.MusicInfo[]) => {
  await init()
  let added = 0
  for (const info of musicInfos) {
    if (info.source == 'local') continue
    const musicInfo = info as LX.Music.MusicInfoOnline
    const exist = tasks.find(t => t.id == musicInfo.id)
    if (exist) {
      if (exist.isComplate) toast(global.i18n.t('alx_download_tip_exists'))
      continue
    }
    tasks.unshift({
      id: musicInfo.id,
      isComplate: false,
      status: 'waiting',
      statusText: '',
      downloaded: 0,
      total: 0,
      progress: 0,
      speed: '',
      metadata: {
        musicInfo,
        url: null,
        quality: settingState.setting['player.playQuality'],
        ext: 'mp3',
        fileName: '',
        filePath: '',
      },
    })
    added++
  }
  if (added > 0) {
    emit()
    persist()
    startNext()
    toast(global.i18n.t('alx_download_added', { num: added }))
  }
  return added
}

export const pauseTask = (taskId: string) => {
  const task = tasks.find(t => t.id == taskId)
  if (!task) return
  const job = running.get(taskId)
  if (job && job.jobId > 0) {
    try {
      RNFS.stopDownload(job.jobId)
    } catch (err) {
      log.warn('[ALX] stop download failed', err)
    }
  }
  updateTask(task, { status: 'pause', statusText: '', speed: '' })
}

export const resumeTask = (taskId: string) => {
  const task = tasks.find(t => t.id == taskId)
  if (!task || task.isComplate) return
  updateTask(task, { status: 'waiting', statusText: '' })
  startNext()
}

export const removeTask = async(taskId: string, deleteFile = false) => {
  const index = tasks.findIndex(t => t.id == taskId)
  if (index < 0) return
  const task = tasks[index]
  pauseTask(taskId)
  tasks.splice(index, 1)
  if (deleteFile && task.metadata.filePath) await removeFile(task.metadata.filePath)
  emit()
  persist()
}

export const clearCompleted = async(deleteFile = false) => {
  const completed = tasks.filter(t => t.isComplate)
  for (const task of completed) {
    if (deleteFile && task.metadata.filePath) await removeFile(task.metadata.filePath)
  }
  tasks = tasks.filter(t => !t.isComplate)
  emit()
  persist()
}

// 设置里改了「同时下载数量」后立即生效(调大时立刻补位)
export const applyConcurrency = () => {
  startNext()
}

export const startAll = () => {
  for (const task of tasks) {
    if (task.status == 'pause' || task.status == 'error') task.status = 'waiting'
  }
  emit()
  persist()
  startNext()
}
