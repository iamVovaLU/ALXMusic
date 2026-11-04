import { memo, useEffect, useState } from 'react'
import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle, toast, confirmDialog } from '@/utils/tools'
import { getExternalStoragePaths } from '@/utils/fs'
import { sizeFormate } from '@/utils/common'
import { log } from '@/utils/log'
import { getAppCacheSize, clearAppCache } from '@/utils/nativeModules/cache'
import { getPlayerCacheDir, getDirSize, clearPlayerCache } from '@/core/cache'
import { countLyricFiles, clearLyricFiles } from '@/core/cache/metaCache'
import { getMetaCache, clearLyric, clearOtherSource } from '@/utils/data'

export default memo(() => {
  const theme = useTheme()
  const cacheLocation = useSettingValue('player.cacheLocation')
  const [playerSize, setPlayerSize] = useState(-1)
  const [appSize, setAppSize] = useState(-1)
  const [lyricCount, setLyricCount] = useState(-1)
  const [otherCount, setOtherCount] = useState(-1)
  const [realPath, setRealPath] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshPath = async() => {
    if (cacheLocation == 'internal') {
      setRealPath('内部存储: /data/user/0/cn.alx.music/files')
      return
    }
    const paths = await getExternalStoragePaths(true).catch(() => [] as string[])
    setRealPath(paths.length ? paths[0] + '/Android/data/cn.alx.music/files' : '⚠️ 没检测到 TF 卡, 实际会回落到内部存储')
  }

  const refreshSize = async() => {
    const dir = await getPlayerCacheDir()
    setPlayerSize(dir ? await getDirSize(dir) : 0)
    void getAppCacheSize().then(setAppSize).catch(() => setAppSize(-1))
    void getMetaCache().then(info => {
      setOtherCount(info.otherSourceKeys?.length ?? 0)
      setLyricCount(info.lyricKeys?.length ?? 0)
    }).catch(() => {})
    if (cacheLocation == 'external') {
      const n = await countLyricFiles().catch(() => 0)
      if (n) setLyricCount(n)
    }
  }

  useEffect(() => {
    setPlayerSize(-1); setAppSize(-1); setLyricCount(-1); setOtherCount(-1)
    void refreshPath()
    void refreshSize()
  }, [cacheLocation])

  const setLocation = (value: 'internal' | 'external') => {
    if (value == 'external') {
      void getExternalStoragePaths(true).then(paths => {
        if (!paths.length) { toast('没检测到 TF 卡'); return }
        updateSetting({ 'player.cacheLocation': value })
        toast('已切换，重启 App 后生效')
        log.info('[ALX] cache location -> external', paths[0])
      })
      return
    }
    updateSetting({ 'player.cacheLocation': value })
    toast('已切换，重启 App 后生效')
  }

  const handleClearPlayer = () => {
    if (busy) return
    void confirmDialog({
      title: '清空播放缓存',
      message: '会删除当前缓存目录里的已缓存歌曲片段（TrackPlayer），不可恢复。\n如果正在播放，清完后请重启 App。',
      confirmButtonText: '清空',
    }).then(async ok => {
      if (!ok) return
      setBusy(true)
      const dir = await getPlayerCacheDir()
      try {
        if (dir) {
          const n = await clearPlayerCache(dir)
          toast('已清空 ' + n + ' 项')
        }
        await refreshSize()
      } catch (err: any) {
        toast('清空失败: ' + (err?.message ?? err))
      } finally { setBusy(false) }
    })
  }

  const handleClearMeta = () => {
    if (busy) return
    void confirmDialog({
      title: '清空歌词/元数据缓存',
      message: '会清空已缓存的歌词和换源匹配记录，不影响歌单和已下载文件。',
      confirmButtonText: '清空',
    }).then(async ok => {
      if (!ok) return
      setBusy(true)
      try {
        const info = await getMetaCache()
        if (info.otherSourceKeys?.length) await clearOtherSource(info.otherSourceKeys)
        if (info.lyricKeys?.length) await clearLyric(info.lyricKeys)
        await clearLyricFiles().catch(() => {})
        toast('已清空')
        await refreshSize()
      } catch (err: any) {
        toast('清空失败: ' + (err?.message ?? err))
      } finally { setBusy(false) }
    })
  }

  const handleClearApp = () => {
    if (busy) return
    void confirmDialog({
      title: '清空应用缓存',
      message: '会清空 App 的临时文件/图片缓存，不影响歌单和下载。',
      confirmButtonText: '清空',
    }).then(async ok => {
      if (!ok) return
      setBusy(true)
      try {
        await clearAppCache()
        toast('已清空')
        await refreshSize()
      } catch (err: any) {
        toast('清空失败: ' + (err?.message ?? err))
      } finally { setBusy(false) }
    })
  }

  return (
    <SubTitle title="缓存（播放 / 歌词 / 图片）">
      <View style={styles.row}>
        <Text size={12} color={theme['c-400']}>缓存位置</Text>
      </View>
      <View style={styles.row}>
        <Text size={11} color={theme['c-400']}>{realPath}</Text>
      </View>
      <View style={styles.btnRow}>
        <Button onPress={() => { setLocation('internal') }}>
          <Text size={12} color={cacheLocation == 'internal' ? theme['c-primary'] : theme['c-350']}>内部存储</Text>
        </Button>
        <Button onPress={() => { setLocation('external') }}>
          <Text size={12} color={cacheLocation == 'external' ? theme['c-primary'] : theme['c-350']}>外置存储(TF卡)</Text>
        </Button>
      </View>

      <View style={styles.row}>
        <Text size={12} color={theme['c-400']}>
          播放缓存: {playerSize < 0 ? '计算中…' : sizeFormate(Math.max(0, playerSize))}
          {'   '}应用/图片缓存: {appSize < 0 ? '计算中…' : sizeFormate(Math.max(0, appSize))}
        </Text>
      </View>
      <View style={styles.row}>
        <Text size={12} color={theme['c-400']}>
          歌词缓存: {lyricCount < 0 ? '…' : `${lyricCount} 首`}
          {'   '}换源记录: {otherCount < 0 ? '…' : `${otherCount} 条`}
        </Text>
      </View>
      <View style={styles.btnRow}>
        <Button onPress={() => { void refreshSize() }}><Text size={12} color={theme['c-350']}>刷新</Text></Button>
        <Button onPress={handleClearPlayer}><Text size={12} color={theme['c-350']}>{busy ? '处理中…' : '清空播放缓存'}</Text></Button>
        <Button onPress={handleClearMeta}><Text size={12} color={theme['c-350']}>清空歌词缓存</Text></Button>
        <Button onPress={handleClearApp}><Text size={12} color={theme['c-350']}>清空应用缓存</Text></Button>
      </View>
      <View style={styles.row}>
        <Text size={10} color={theme['c-350']}>
          说明：播放缓存和歌词缓存会跟随上面的位置落盘；封面图的磁盘缓存由系统图片组件管理，暂不支持迁移。
          切换位置后需要重启 App 才生效。
        </Text>
      </View>
    </SubTitle>
  )
})

const styles = createStyle({
  row: { marginTop: 4 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
})
