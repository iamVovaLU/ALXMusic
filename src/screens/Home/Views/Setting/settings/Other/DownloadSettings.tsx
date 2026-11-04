import { memo, useState } from 'react'
import { View } from 'react-native'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle, toast } from '@/utils/tools'
import { selectManagedFolder } from '@/utils/fs'
import Text from '@/components/common/Text'
import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import { log } from '@/utils/log'

const DownloadSettings = memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const savePath = useSettingValue('download.savePath')
  const fileNameType = useSettingValue('download.fileName')
  const [busy, setBusy] = useState(false)

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

  const fileNameTypes: Array<LX.AppSetting['download.fileName']> = ['歌名 - 歌手', '歌手 - 歌名', '歌名']

  return (
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
  )
})

const styles = createStyle({
  row: { marginTop: 4 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
})

export default DownloadSettings
