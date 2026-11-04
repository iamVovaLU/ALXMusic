import { memo, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle, toast, confirmDialog } from '@/utils/tools'
import { selectManagedFolder, getExternalStoragePaths } from '@/utils/fs'
import Text from '@/components/common/Text'
import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import { log } from '@/utils/log'
import { getPlayerCacheDir, getDirSize, clearPlayerCache } from '@/core/cache'
import { sizeFormate } from '@/utils/common'

const DownloadSettings = memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const savePath = useSettingValue('download.savePath')
  const fileNameType = useSettingValue('download.fileName')
  const cacheLocation = useSettingValue('player.cacheLocation')
  const [busy, setBusy] = useState(false)
  const [cacheSize, setCacheSize] = useState(-1)
  const [clearing, setClearing] = useState(false)

  // 显示真实的缓存落盘位置: 选了 TF 卡但卡不在时, 播放器会静默回落到内部存储
  const [cacheRealPath, setCacheRealPath] = useState('')
  useEffect(() => {
    let canceled = false
    void (async() => {
      if (cacheLocation == 'internal') {
        if (!canceled) setCacheRealPath('内部存储: /data/user/0/cn.alx.music/files/TrackPlayer')
        return
      }
      const paths = await getExternalStoragePaths(true).catch(() => [] as string[])
      if (canceled) return
      setCacheRealPath(paths.length
        ? paths[0] + '/Android/data/cn.alx.music/files/TrackPlayer'
        : '⚠️ 没检测到 TF 卡, 实际会回落到内部存储')
    })()
    return () => { canceled = true }
  }, [cacheLocation])

  const refreshCacheSize = async() => {
    const dir = await getPlayerCacheDir()
    if (!dir) {
      setCacheSize(-1)
      return
    }
    const size = await getDirSize(dir)
    setCacheSize(size)
  }

  useEffect(() => {
    setCacheSize(-1)
    void refreshCacheSize()
  }, [cacheLocation])

  const handleClearCache = () => {
    if (clearing) return
    void confirmDialog({
      title: '清空缓存',
      message: '会删除当前缓存目录里的所有已缓存歌曲，且不可恢复。\n如果正在播放，清完后请重启 App。',
      confirmButtonText: '清空',
    }).then(async(ok) => {
      if (!ok) return
      setClearing(true)
      const dir = await getPlayerCacheDir()
      if (!dir) {
        toast('没找到缓存目录')
        setClearing(false)
        return
      }
      try {
        const n = await clearPlayerCache(dir)
        toast('已清空 ' + n + ' 项，重启 App 后生效')
        log.info('[ALX] player cache cleared', dir, n)
        await refreshCacheSize()
      } catch (err: any) {
        toast('清空失败: ' + (err?.message ?? err))
        log.error('[ALX] clear player cache failed', err)
      } finally {
        setClearing(false)
      }
    })
  }

  const handleSelectDir = () => {
    if (busy) return
    setBusy(true)
    void selectManagedFolder(true).then(dir => {
      if (!dir) return
      updateSetting({ 'download.savePath': dir.path })
      toast(t('alx_setting_download_dir_selected', { name: dir.name || dir.path }))
      log.info('[ALX] download dir set to', dir.path)
    }).catch(err => {
      log.error('[ALX] select download dir failed', err)
      toast(t('alx_setting_download_dir_failed', { msg: err?.message ?? err }))
    }).finally(() => {
      setBusy(false)
    })
  }

  const handleClearDir = () => {
    updateSetting({ 'download.savePath': '' })
    toast(t('alx_setting_download_dir_cleared'))
  }

  const handleCacheLocation = (value: 'internal' | 'external') => {
    if (value == 'external') {
      void getExternalStoragePaths(true).then(paths => {
        if (!paths.length) {
          toast(t('alx_setting_cache_external_missing'))
          return
        }
        updateSetting({ 'player.cacheLocation': value })
        toast(t('alx_setting_cache_need_restart'))
        log.info('[ALX] cache location -> external', paths[0])
      }).catch(err => {
        log.error('[ALX] get external storage failed', err)
        toast(String(err?.message ?? err))
      })
      return
    }
    updateSetting({ 'player.cacheLocation': value })
    toast(t('alx_setting_cache_need_restart'))
  }

  const fileNameTypes: Array<LX.AppSetting['download.fileName']> = ['歌名 - 歌手', '歌手 - 歌名', '歌名']

  return (
    <>
      <SubTitle title={t('alx_setting_download_title')}>
        <View style={styles.row}>
          <Text size={13} color={theme['c-400']} numberOfLines={2}>
            {savePath ? savePath : t('alx_download_default_dir')}
          </Text>
        </View>
        <View style={styles.btnRow}>
          <Button onPress={handleSelectDir}>{t('alx_setting_download_dir_select')}</Button>
          {savePath ? <Button onPress={handleClearDir}>{t('alx_setting_download_dir_clear')}</Button> : null}
        </View>
        <View style={styles.row}>
          <Text size={13} color={theme['c-400']}>{t('alx_setting_download_file_name')}</Text>
        </View>
        <View style={styles.btnRow}>
          {fileNameTypes.map(type => (
            <Button key={type} onPress={() => { updateSetting({ 'download.fileName': type }) }}>
              <Text size={12} color={fileNameType == type ? theme['c-primary'] : theme['c-350']}>{type}</Text>
            </Button>
          ))}
        </View>
      </SubTitle>
      <SubTitle title={t('alx_setting_cache_title')}>
        <View style={styles.row}>
          <Text size={12} color={theme['c-400']}>{t('alx_setting_cache_hint')}</Text>
        </View>
        <View style={styles.row}>
          <Text size={11} color={theme['c-400']}>{cacheRealPath}</Text>
        </View>
        <View style={styles.row}>
          <Text size={12} color={theme['c-400']}>
            {cacheSize < 0 ? '缓存占用: 计算中…' : '缓存占用: ' + sizeFormate(cacheSize)}
          </Text>
        </View>
        <View style={styles.btnRow}>
          <Button onPress={() => { handleCacheLocation('internal') }}>
            <Text size={12} color={cacheLocation == 'internal' ? theme['c-primary'] : theme['c-350']}>{t('alx_setting_cache_internal')}</Text>
          </Button>
          <Button onPress={() => { handleCacheLocation('external') }}>
            <Text size={12} color={cacheLocation == 'external' ? theme['c-primary'] : theme['c-350']}>{t('alx_setting_cache_external')}</Text>
          </Button>
        </View>
        <View style={styles.btnRow}>
          <Button onPress={() => { void refreshCacheSize() }}>
            <Text size={12} color={theme['c-350']}>刷新占用</Text>
          </Button>
          <Button onPress={handleClearCache}>
            <Text size={12} color={theme['c-350']}>{clearing ? '清空中…' : '清空缓存'}</Text>
          </Button>
        </View>
      </SubTitle>
    </>
  )
})

const styles = createStyle({
  row: { marginTop: 4 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
})

export default DownloadSettings
