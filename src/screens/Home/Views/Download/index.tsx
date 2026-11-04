import { useEffect, useMemo, useState, useCallback } from 'react'
import { View, FlatList, TouchableOpacity } from 'react-native'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { LIST_IDS } from '@/config/constant'
import { addListMusics } from '@/core/list'
import { playListById } from '@/core/player/player'
import settingState from '@/store/setting/state'
import {
  init as initDownloads,
  subscribe,
  removeTask,
  pauseTask,
  resumeTask,
  startAll,
  clearCompleted,
} from '@/core/download'

const DownloadView = () => {
  const t = useI18n()
  const theme = useTheme()
  const [list, setList] = useState<LX.Download.ListItem[]>([])

  useEffect(() => {
    let mounted = true
    void initDownloads()
    const unsub = subscribe(data => {
      if (mounted) setList(data)
    })
    return () => {
      mounted = false
      unsub()
    }
  }, [])

  const completedCount = useMemo(() => list.filter(item => item.isComplate).length, [list])
  const dir = settingState.setting['download.savePath'] || global.i18n.t('alx_download_default_dir')

  const handlePlay = useCallback((item: LX.Download.ListItem) => {
    if (!item.isComplate) return
    const musicInfo = item.metadata.musicInfo
    void addListMusics(LIST_IDS.DEFAULT, [musicInfo], 'top').then(() => {
      void playListById(LIST_IDS.DEFAULT, musicInfo.id)
    })
  }, [])

  const renderItem = ({ item }: { item: LX.Download.ListItem }) => {
    const isRunning = item.status == 'run'
    const isError = item.status == 'error'
    const percent = Math.round((item.progress || 0) * 100)
    const statusText = item.isComplate
      ? t('alx_download_completed')
      : isError
        ? (item.statusText || t('alx_download_failed'))
        : isRunning
          ? `${percent}%${item.speed ? ' · ' + item.speed : ''}`
          : item.statusText || t('alx_download_waiting')

    return (
      <TouchableOpacity style={styles.row} onPress={() => handlePlay(item)} activeOpacity={0.7}>
        <View style={styles.rowInfo}>
          <Text numberOfLines={1}>{item.metadata.musicInfo.name}</Text>
          <Text style={styles.sub} size={12} color={isError ? theme['c-primary'] : theme['c-400']} numberOfLines={1}>
            {item.metadata.musicInfo.singer} · {statusText}
          </Text>
          {!item.isComplate && !isError ? (
            <View style={styles.progressTrack}>
              <View style={{ ...styles.progressBar, width: `${percent}%`, backgroundColor: theme['c-primary'] }} />
            </View>
          ) : null}
        </View>
        <View style={styles.actions}>
          {item.isComplate
            ? <Icon name="play" size={18} color={theme['c-350']} />
            : isRunning
              ? (
                <TouchableOpacity onPress={() => pauseTask(item.id)} style={styles.actionBtn}>
                  <Icon name="pause" size={18} color={theme['c-350']} />
                </TouchableOpacity>
                )
              : (
                <TouchableOpacity onPress={() => resumeTask(item.id)} style={styles.actionBtn}>
                  <Icon name="download-2" size={18} color={theme['c-350']} />
                </TouchableOpacity>
                )}
          <TouchableOpacity onPress={() => { void removeTask(item.id, false) }} style={styles.actionBtn}>
            <Icon name="close" size={16} color={theme['c-350']} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text size={13} color={theme['c-400']} numberOfLines={1}>
          {t('alx_download_summary', { done: completedCount, total: list.length })}
        </Text>
        <Text size={11} color={theme['c-350']} numberOfLines={1}>{t('alx_download_dir')}{dir}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => { startAll(); toast(t('alx_download_start_all_tip')) }}>
            <Text size={12}>{t('alx_download_start_all')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => { void clearCompleted(false) }}>
            <Text size={12}>{t('alx_download_clear_done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      {
        list.length
          ? <FlatList data={list} keyExtractor={item => item.id} renderItem={renderItem} />
          : <View style={styles.empty}><Text color={theme['c-400']}>{t('alx_download_empty')}</Text></View>
      }
    </View>
  )
}

const styles = createStyle({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  headerActions: { flexDirection: 'row', marginTop: 6 },
  headerBtn: { paddingRight: 16, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  rowInfo: { flex: 1, paddingRight: 8 },
  sub: { marginTop: 3 },
  progressTrack: { height: 3, backgroundColor: 'rgba(128,128,128,0.25)', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  progressBar: { height: 3, borderRadius: 2 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { padding: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})

export default DownloadView
