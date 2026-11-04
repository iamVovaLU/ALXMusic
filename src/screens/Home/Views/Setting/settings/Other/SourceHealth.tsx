import { memo, useEffect, useState } from 'react'
import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import Text from '@/components/common/Text'
import { createStyle, toast, confirmDialog } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import settingState from '@/store/setting/state'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { getStats, getEvents, clearStats, initSourceHealth, type SourceStat, type HealthEvent } from '@/core/music/sourceHealth'

const SOURCE_NAMES: Record<string, string> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ',
  wy: '网易',
  mg: '咪咕',
}

const fmtTime = (ts: number) => {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const statusOf = (s: SourceStat) => {
  const left = s.cooldownUntil - Date.now()
  if (left > 0) return `冷却 ${Math.ceil(left / 1000)}s`
  if (!s.attempts) return '未使用'
  const rate = s.success / s.attempts
  if (rate >= 0.9) return '健康'
  if (rate >= 0.6) return '一般'
  return '差'
}

export default memo(() => {
  const theme = useTheme()
  const raceAll = useSettingValue('player.raceAllSources')
  const [stats, setStats] = useState<SourceStat[]>([])
  const [events, setEvents] = useState<HealthEvent[]>([])

  const refresh = () => {
    setStats(getStats())
    setEvents(getEvents())
  }

  useEffect(() => {
    void initSourceHealth().then(refresh)
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])

  const handleClear = () => {
    void confirmDialog({
      title: '清空音源统计',
      message: '会清空所有源的成功率/耗时记录和冷却状态，不影响已导入的音源。',
      confirmButtonText: '清空',
    }).then(async ok => {
      if (!ok) return
      await clearStats()
      refresh()
      toast('已清空')
    })
  }

  const apiSource = settingState.setting['common.apiSource'] || '内置源'

  return (
    <SubTitle title="音源健康 / 竞速换源">
      <View style={styles.row}>
        <Text size={12} color={theme['c-400']}>
          当前音源: {apiSource}
        </Text>
      </View>
      <View style={styles.row}>
        <Text size={11} color={theme['c-350']}>
          取链接不再串行挨个试：多个源同时抢，第一个返回且验证可播（HTTP 200/206 + 非网页）的胜出。
          连续失败 3 次的源进入冷却，按 1→2→4… 分钟递增；开关关闭时只在当前源失败后才竞速。
        </Text>
      </View>

      <View style={styles.btnRow}>
        <Text size={12} color={theme['c-350']}>全源竞速：</Text>
        <Button onPress={() => { updateSetting({ 'player.raceAllSources': true }); toast('已开启，之后每次播放都会多源并行') }}>
          <Text size={12} color={raceAll ? theme['c-primary'] : theme['c-350']}>开</Text>
        </Button>
        <Button onPress={() => { updateSetting({ 'player.raceAllSources': false }); toast('已关闭，改为失败后才换源') }}>
          <Text size={12} color={raceAll ? theme['c-350'] : theme['c-primary']}>关</Text>
        </Button>
      </View>
      <View style={styles.row}>
        <Text size={10} color={theme['c-350']}>
          开：每次播放都把当前源和所有匹配到的源一起放出去抢，先返回且验证通过的直接用（会多出几次搜索请求）。
          关：只有当前源失败时才竞速。
        </Text>
      </View>
      <View style={styles.btnRow}>
        <Button onPress={refresh}><Text size={12} color={theme['c-350']}>刷新</Text></Button>
        <Button onPress={handleClear}><Text size={12} color={theme['c-350']}>清空统计</Text></Button>
      </View>

      {stats.length
        ? stats.map(s => (
          <View key={s.key} style={styles.card}>
            <View style={styles.titleRow}>
              <Text size={13} color={theme['c-100']}>
                {(SOURCE_NAMES[s.source] || s.source)} · {s.apiSource || '内置'}
              </Text>
              <Text size={12} color={theme['c-350']}>{statusOf(s)}</Text>
            </View>
            <Text size={11} color={theme['c-400']}>
              成功 {s.success}/{s.attempts}
              {s.attempts ? ` (${Math.round(s.success / s.attempts * 100)}%)` : ''}
              {'  '}平均 {s.avgMs ? `${s.avgMs}ms` : '-'}
              {'  '}最近成功 {fmtTime(s.lastOkAt)}
            </Text>
            {s.lastError
              ? <Text size={11} color={theme['c-400']} numberOfLines={2}>最近错误: {s.lastError}</Text>
              : null}
          </View>
        ))
        : <View style={styles.row}><Text size={12} color={theme['c-400']}>还没有记录，播放几首歌就有了</Text></View>}

      {events.length
        ? (
          <View style={styles.card}>
            <Text size={12} color={theme['c-100']}>最近竞速</Text>
            {events.slice(0, 6).map((e, i) => (
              <Text key={`${e.at}-${i}`} size={11} color={theme['c-400']} numberOfLines={1}>
                {fmtTime(e.at)}  {e.text}
              </Text>
            ))}
          </View>
        )
        : null}
    </SubTitle>
  )
})

const styles = createStyle({
  row: { marginTop: 4 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  card: { marginTop: 8, paddingVertical: 4 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
})
