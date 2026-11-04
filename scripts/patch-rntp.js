#!/usr/bin/env node
// Re-applies ALXMusic patches to react-native-track-player after `npm ci`.
// Safe to run multiple times.
const fs = require('fs')
const path = require('path')

const base = path.join(__dirname, '..', 'node_modules', 'react-native-track-player')
if (!fs.existsSync(base)) {
  console.log('[alx-patch] react-native-track-player not installed, skip')
  process.exit(0)
}

const read = p => fs.readFileSync(p, 'utf8')
const write = (p, s) => fs.writeFileSync(p, s)

const mmPath = path.join(base, 'android/src/main/java/com/guichaguri/trackplayer/module/MusicModule.java')
const lpPath = path.join(base, 'android/src/main/java/com/guichaguri/trackplayer/service/player/LocalPlayback.java')
const tjPath = path.join(base, 'lib/trackPlayer.js')
const tdPath = path.join(base, 'lib/trackPlayer.d.ts')

let mm = read(mmPath)
if (!mm.includes('ALX_CACHE_PATCH')) {
  const anchor = `    @ReactMethod
    public void add(ReadableArray tracks, final Integer insertBeforeIndex, final Promise callback) {`
  const patch = `    // ALX_CACHE_PATCH: allow JS to choose the ExoPlayer cache directory
    @ReactMethod
    public void setCachePath(String path, final Promise callback) {
        try {
            getReactApplicationContext()
                .getSharedPreferences("alx_settings", android.content.Context.MODE_PRIVATE)
                .edit().putString("cache_path", path == null ? "" : path).apply();
            callback.resolve(null);
        } catch (Exception ex) {
            callback.reject(ex);
        }
    }

    @ReactMethod
    public void getCachePath(final Promise callback) {
        try {
            String path = getReactApplicationContext()
                .getSharedPreferences("alx_settings", android.content.Context.MODE_PRIVATE)
                .getString("cache_path", "");
            callback.resolve(path);
        } catch (Exception ex) {
            callback.reject(ex);
        }
    }

` + anchor
  if (!mm.includes(anchor)) throw new Error('MusicModule.java anchor not found')
  write(mmPath, mm.replace(anchor, patch))
  console.log('[alx-patch] MusicModule.java patched')
}

let lp = read(lpPath)
if (!lp.includes('ALX_CACHE_PATCH')) {
  const old = `        if(cacheMaxSize > 0) {
            File cacheDir = new File(context.getFilesDir(), "TrackPlayer");
            DatabaseProvider db = new StandaloneDatabaseProvider(context);
            cache = new SimpleCache(cacheDir, new LeastRecentlyUsedCacheEvictor(cacheMaxSize), db);
        } else {
            cache = null;
        }`
  const neu = `        if(cacheMaxSize > 0) {
            // ALX_CACHE_PATCH: use the user selected cache directory when available
            String customPath = context.getSharedPreferences("alx_settings", Context.MODE_PRIVATE).getString("cache_path", "");
            File cacheDir = null;
            if (customPath != null && !customPath.isEmpty()) {
                File custom = new File(customPath);
                if (custom.isDirectory() || custom.mkdirs()) cacheDir = custom;
            }
            if (cacheDir == null) cacheDir = new File(context.getFilesDir(), "TrackPlayer");
            if (!cacheDir.isDirectory() && !cacheDir.mkdirs()) cacheDir = new File(context.getFilesDir(), "TrackPlayer");
            Log.d(Utils.LOG, "ALX cache dir: " + cacheDir.getAbsolutePath());
            DatabaseProvider db = new StandaloneDatabaseProvider(context);
            cache = new SimpleCache(cacheDir, new LeastRecentlyUsedCacheEvictor(cacheMaxSize), db);
        } else {
            cache = null;
        }`
  if (!lp.includes(old)) throw new Error('LocalPlayback.java anchor not found')
  write(lpPath, lp.replace(old, neu))
  console.log('[alx-patch] LocalPlayback.java patched')
}

let tj = read(tjPath)
if (!tj.includes('setCachePath')) {
  const old = 'exports.default = {'
  const neu = `function setCachePath(path) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, TrackPlayer.setCachePath(path)];
        });
    });
}
exports.default = {`
  if (!tj.includes(old)) throw new Error('trackPlayer.js anchor not found')
  tj = tj.replace(old, neu)
  tj = tj.replace('    isCached: isCached,', '    setCachePath: setCachePath,\n    isCached: isCached,')
  write(tjPath, tj)
  console.log('[alx-patch] lib/trackPlayer.js patched')
}

let td = read(tdPath)
if (!td.includes('setCachePath')) {
  td = td.replace('declare function isCached(url: string): Promise<boolean>;', 'declare function setCachePath(path: string): Promise<void>;\ndeclare function isCached(url: string): Promise<boolean>;')
  td = td.replace('    isCached: typeof isCached;', '    setCachePath: typeof setCachePath;\n    isCached: typeof isCached;')
  write(tdPath, td)
  console.log('[alx-patch] lib/trackPlayer.d.ts patched')
}

console.log('[alx-patch] done')
