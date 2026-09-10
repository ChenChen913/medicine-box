/* 家庭药箱 · Service Worker
 * 目标：应用外壳离线可用（断网也能打开、查看/录入本机数据）。
 *
 * 缓存策略（v2 起按资源类型区分）：
 *   - 导航请求：网络优先（保证拿到新版本），离线回退缓存的外壳页；
 *   - /assets/*（Vite 产物，文件名带内容哈希，内容永不变）：缓存优先；
 *   - 其它同源 GET（index.html / manifest / 图标等非哈希文件）：
 *     网络优先 + 成功回填，避免旧缓存把内容"粘住"；
 *   - 只接管同源 GET，不碰任何跨域/写请求。
 *
 * 注意：改动缓存策略时务必同时改 CACHE 版本号 —— activate 里会清掉旧版本缓存，
 * 否则老设备会继续用旧策略（曾在真机上造成过"点了页面空白"的现象）。
 */
const CACHE = 'medicine-box-v2';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isImmutableAsset(url) {
  return url.pathname.includes('/assets/');
}

function fromCacheFirst(req) {
  return caches.match(req).then(hit => {
    if (hit) return hit;
    return fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => undefined);
      }
      return res;
    });
  });
}

function fromNetworkFirst(req) {
  return fetch(req)
    .then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => undefined);
      }
      return res;
    })
    .catch(() => caches.match(req).then(hit => hit || Response.error()));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  event.respondWith(isImmutableAsset(url) ? fromCacheFirst(req) : fromNetworkFirst(req));
});
