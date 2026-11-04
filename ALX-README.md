# ALXMusic

基于 [LX Music 移动版](https://github.com/lyswhut/lx-music-mobile) v1.9.2 的个人定制版。
包名 `cn.alx.music`，可以和原版 LX Music 共存安装。

## 更新日志

### v1.9.4-alx
- **修复：删掉整个下载目录的严重 bug。** 选过下载目录（SAF tree URI）后，
  下载完成前会执行 `removeFile(目标路径)`，而 `content://.../tree/xxx/文件名` 这种拼接路径会被
  `DocumentFile.fromTreeUri()` 解析回目录本身，底层 `unlink` 是递归删除 → 整个目录被清空。
  现在会先在父目录里按名字找到真正的 document URI，且任何情况下都不删除目录。
- 设置页「播放缓存位置」下面显示**实际落盘路径**，没检测到 TF 卡时直接提示「会回落到内部存储」。
- 新增**缓存占用大小**显示 + 「刷新占用」「清空缓存」按钮（只清空 TrackPlayer 目录内容，目录本身保留）。

## 已实现的功能

1. **收藏到歌单时，已存在就置顶**
   - 原行为：提示「列表已经存在这首歌啦」并拒绝操作
   - 现行为：把该歌曲移动到目标歌单第一位，并提示「已置顶」
   - 位置：`src/components/MusicAddModal/ListItem.tsx`

2. **音乐下载**（原移动版把下载功能整个注释掉了，这里重新实现）
   - 歌曲菜单（我的列表 / 搜索结果）→ 下载
   - 新的「下载」底部标签页：进度、速度、暂停/继续、全部开始、清除已完成
   - 已下载的歌曲播放时优先使用本地文件
   - 下载目录：设置 → 其他 → 下载 → 选择下载目录（SAF 选择任意文件夹，包括 TF 卡）
   - 默认目录：应用私有目录 `files/ALXMusic/Download`
   - 文件名模板沿用原设置（歌名 - 歌手 / 歌手 - 歌名 / 歌名）
   - 并发 2 个任务；应用被杀掉后任务会保存，下次启动可在下载页继续

3. **播放缓存目录可切换到外置存储（TF 卡）**
   - 设置 → 其他 → 播放缓存位置 → 内部存储 / 外置存储
   - 外置模式写入 `TF卡/Android/data/cn.alx.music/files/TrackPlayer`
   - 不需要额外存储权限；卸载应用会一起清除
   - **修改后需要重启应用**（ExoPlayer 的 SimpleCache 在启动时创建）
   - 实现：给 `react-native-track-player` 打了补丁（`MusicModule.setCachePath` + `LocalPlayback` 读取偏好设置）

4. **默认开启日志**
   - 日志文件：`/data/data/cn.alx.music/files/logs/alx.log`（应用私有目录，不会被系统清理）
   - 同步日志、用户 API 日志默认开启
   - 应用内查看：设置 → 其他 → 日志管理

## 构建

环境：JDK 17、Android SDK Platform 36 / Build-Tools 35.0.0 / NDK 26.1.10909125、Node 18+。

```bash
npm ci
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

产物：`android/app/build/outputs/apk/release/ALXMusic-v1.9.2-alx-*.apk`

签名：`android/keystore.properties` + `android/app/alx-release.keystore`（自签名，勿外传）。

`npm ci` 后会自动执行 `scripts/patch-rntp.js` 重新打上 track-player 缓存目录补丁。

## 已知限制

- 下载没有通知栏进度、没有后台服务（应用退到后台可能被系统暂停）
- 下载不支持断点续传（暂停后再点继续会从头下载）
- 只写音频文件，不写 ID3 标签/封面/歌词
- 缓存目录只能选「应用私有外置目录」，不能选任意 SAF 文件夹（ExoPlayer 需要随机读写，SAF 的 content:// 不支持）
- `targetSdk` 仍是 29，沿用旧版存储行为；上架 Google Play 需要重做存储层

## 合规

本项目基于 Apache-2.0 协议修改自 lx-music-mobile，保留原始 LICENSE。
仅供个人学习使用，禁止商业分发；请支持正版音乐。
