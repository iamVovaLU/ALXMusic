import { memo, useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import Button from '../Setting/components/Button'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast, confirmDialog } from '@/utils/tools'
import { getLogs, clearLogs } from '@/utils/log'
import { getPlayerCacheDir } from '@/core/cache'
import { privateStorageDirectoryPath } from '@/utils/fs'
import settingState from '@/store/setting/state'
import SourceHealth from '../Setting/settings/Other/SourceHealth'
import { initListenStats, getTopSongs, getTopSingers, getTopAlbums, getListenSummary, clearListenStats, formatDuration, type RankItem } from '@/core/stats/listenStats'
import { version } from '../../../../../package.json'

const TABS = [
  { id: 'listened', name: '听榜' },
  { id: 'log', name: '实时日志' },
  { id: 'health', name: '音源健康' },
  { id: 'status', name: '运行状态' },
] as const

type TabId = typeof TABS[number]['id']

const LogTab = memo(() => {
  const theme = useTheme()
  const [text, setText] = useState('')
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<ScrollView>(null)

  const load = () => {
    void getLogs().then(content => {
      const lines = String(content ?? '').split('\n')
      setText(lines.slice(-300).join('\n'))
    }).catch(err => {
      setText('读取日志失败: ' + (err?.message ?? err))
    })
  }

  useEffect(() => {
    load()
    if (paused) return
    const timer = setInterval(load, 1500)
    return () => clearInterval(timer)
  }, [paused])

  useEffect(() => {
    if (!autoScroll) return
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }))
  }, [text, autoScroll])

  const handleClear = () => {
    void confirmDialog({
      title: '清空日志',
      message: '会删除 alx.log 的全部内容，不影响其他数据。',
      confirmButtonText: '清空',
    }).then(async ok => {
      if (!ok) return
      await clearLogs()
      load()
      toast('已清空')
    })
  }

  return (
    <View style={styles.flex}>
      <View style={styles.btnRow}>
        <Button onPress={() => { setPaused(p => !p) }}><Text size={12} color={theme['c-350']}>{paused ? '继续' : '暂停'}</Text></Button>
        <Button onPress={load}><Text size={12} color={theme['c-350']}>刷新</Text></Button>
        <Button onPress={() => { setAutoScroll(v => !v) }}><Text size={12} color={theme['c-350']}>{autoScroll ? '关闭自动滚动' : '自动滚动'}</Text></Button>
        <Button onPress={handleClear}><Text size={12} color={theme['c-350']}>清空</Text></Button>
      </View>
      <ScrollView ref={scrollRef} style={styles.logBox} onScrollBeginDrag={() => { setAutoScroll(false) }}>
        <Text size={10} color={theme['c-350']} style={styles.logText}>{text || '(空)'}</Text>
      </ScrollView>
    </View>
  )
})

const ListenTab = memo(() => {
  const theme = useTheme()
  const [mode, setMode] = useState<'song' | 'singer' | 'album'>('song')
  const [rows, setRows] = useState<RankItem[]>([])
  const [summary, setSummary] = useState({ songs: 0, seconds: 0 })

  const load = (m: 'song' | 'singer' | 'album' = mode) => {
    setSummary(getListenSummary())
    setRows(m == 'song' ? getTopSongs(100) : m == 'singer' ? getTopSingers(100) : getTopAlbums(100))
  }

  useEffect(() => {
    void initListenStats().then(() => load())
  }, [])

  const switchMode = (m: 'song' | 'singer' | 'album') => {
    setMode(m)
    load(m)
  }

  const handleClear = () => {
    void confirmDialog({
      title: '清空听歌统计',
      message: '会清空所有收听时长记录，不可恢复。',
      confirmButtonText: '清空',
    }).then(async ok => {
      if (!ok) return
      await clearListenStats()
      load()
      toast('已清空')
    })
  }

  const modeBtn = (id: 'song' | 'singer' | 'album', label: string) => (
    <Button onPress={() => { switchMode(id) }}>
      <Text size={12} color={mode == id ? theme['c-primary'] : theme['c-350']}>{label}</Text>
    </Button>
  )

  return (
    <View style={styles.flex}>
      <View style={styles.btnRow}>
        <Text size={12} color={theme['c-400']}>共 {summary.songs} 首歌 · 总计 {formatDuration(summary.seconds)}</Text>
      </View>
      <View style={styles.btnRow}>
        {modeBtn('song', '歌曲')}
        {modeBtn('singer', '歌手')}
        {modeBtn('album', '专辑')}
        <Button onPress={() => { load() }}><Text size={12} color={theme['c-350']}>刷新</Text></Button>
        <Button onPress={handleClear}><Text size={12} color={theme['c-350']}>清空</Text></Button>
      </View>
      <ScrollView style={styles.flex}>
        {rows.length
          ? rows.map((row, index) => (
            <View key={row.key} style={styles.rankRow}>
              <Text size={12} color={theme['c-350']} style={styles.rankNo}>{index + 1}</Text>
              <View style={styles.rankMain}>
                <Text size={13} color={theme['c-100']} numberOfLines={1}>{row.name}</Text>
                {row.sub ? <Text size={10} color={theme['c-400']} numberOfLines={1}>{row.sub}{mode != 'song' ? ` · ${row.songs} 首` : ''}</Text> : null}
              </View>
              <Text size={12} color={theme['c-primary']}>{formatDuration(row.seconds)}</Text>
            </View>
          ))
          : <View style={styles.btnRow}><Text size={12} color={theme['c-400']}>还没有记录，去听几首歌吧</Text></View>}
      </ScrollView>
    </View>
  )
})

const StatusTab = memo(() => {
  const theme = useTheme()
  const [cacheDir, setCacheDir] = useState('')
  useEffect(() => { void getPlayerCacheDir().then(dir => setCacheDir(dir || '(内部存储)')) }, [])
  const rows: Array<[string, string]> = [
    ['版本', version],
    ['包名', 'cn.alx.music'],
    ['当前音源', settingState.setting['common.apiSource'] || '内置源'],
    ['播放缓存目录', cacheDir],
    ['日志文件', privateStorageDirectoryPath + '/logs/alx.log'],
  ]
  return (
    <ScrollView style={styles.flex}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.statusRow}>
          <Text size={12} color={theme['c-350']}>{k}</Text>
          <Text size={11} color={theme['c-400']} style={styles.statusValue}>{v}</Text>
        </View>
      ))}
      <View style={styles.statusRow}>
        <Text size={11} color={theme['c-400']}>
          播放失败时同时向最多 4 个健康源取链接并验证，详见「音源健康」标签。
        </Text>
      </View>
    </ScrollView>
  )
})

export default memo(() => {
  const theme = useTheme()
  const [tab, setTab] = useState<TabId>('listened')

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {TABS.map(item => (
          <TouchableOpacity key={item.id} style={[styles.tabItem, tab === item.id ? styles.tabItemActive : null]} onPress={() => { setTab(item.id) }}>
            <Text size={13} color={tab === item.id ? theme['c-primary-font-active'] : theme['c-350']}>{item.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.content}>
        {tab === 'listened' ? <ListenTab /> : null}
        {tab === 'log' ? <LogTab /> : null}
        {tab === 'health' ? <ScrollView style={styles.flex}><SourceHealth /></ScrollView> : null}
        {tab === 'status' ? <StatusTab /> : null}
      </View>
    </View>
  )
})

const styles = createStyle({
  container: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.25)',
  },
  tabItem: { paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: 'transparent' },
  content: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  flex: { flex: 1 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  logBox: { flex: 1 },
  logText: { fontFamily: 'monospace' },
  statusRow: { marginTop: 10 },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  rankNo: { width: 30 },
  rankMain: { flex: 1, paddingRight: 8 },
  statusValue: { marginTop: 2 },
})
