/* ===========================================================
   TOKYO WASABI 資材在庫 ― service worker

   役割はふたつだけ。
   1. ホーム画面に追加（インストール）できるようにする
   2. 電波が悪くても、画面そのものは開けるようにする

   在庫データ（GAS との通信）は絶対にここに保存しません。
   古い在庫数が出ると事故になるためです。ここで扱うのは
   HTML・CSS・JS・アイコンだけです。

   HTML/CSS/JS は「まずネットから取りに行き、だめなら手元の控えを使う」
   ようにしてあるので、push した新しい版は次に開いたときすぐ反映されます。
   =========================================================== */

const VERSION = 'v2'; // ← 中身を作り直したいときはここの数字を上げる
const SHELL = 'shell-' + VERSION; // 画面のファイル（毎回ネットを優先）
const ASSETS = 'assets-' + VERSION; // アイコンなど（めったに変わらない）

const SHELL_FILES = [
  './',
  './index.html',
  './admin.html',
  './style.css',
  './common.js',
  './app.js',
  './admin.js',
];

const ASSET_FILES = [
  './manifest.webmanifest',
  './admin.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/admin-180.png',
  './icons/admin-192.png',
  './icons/admin-512.png',
  './icons/admin-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      await (await caches.open(SHELL)).addAll(SHELL_FILES);
      await (await caches.open(ASSETS)).addAll(ASSET_FILES);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // 書き込み（POST）には一切さわらない
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // GAS など、よそへの通信はそのまま素通しする（在庫データは保存しない）
  if (url.origin !== self.location.origin) return;

  const isAsset = url.pathname.includes('/icons/') || url.pathname.endsWith('.webmanifest');
  e.respondWith(isAsset ? cacheFirst(req) : networkFirst(req));
});

/** アイコンなど: 手元にあればそれを使う */
async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

/** 画面のファイル: まずネット。つながらないときだけ手元の控えを使う */
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    // 画面そのものを開こうとして圏外だったときは、スタッフ用の画面を返す
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}
