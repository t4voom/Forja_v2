/* FORJA — service worker
   · Deixa o app abrir sem internet: guarda no aparelho a página e os arquivos que ela usa.
     - Página (index.html): internet primeiro, para abrir sempre a versão mais nova. Sem internet,
       ou com sinal ruim (mais de NAV_TIMEOUT), abre a cópia guardada.
     - Arquivos com ?v=... (js, css): do aparelho. Cada versão tem um endereço próprio, então nunca fica velho.
     - A lista de arquivos vem do próprio index.html: publicar uma versão nova (trocar o ?v=) já basta.
   · Não mexe nas chamadas ao Google Planilhas (POST para o Apps Script, outro endereço) nem em
     nada fora da pasta do app (ex.: o FORJA Trainer em /trainer/ no mesmo site).
   · Notificações dos lembretes (o Android exige um service worker). */
const CACHE = 'forja-app-v1';
const SCOPE = new URL('./', self.location).href;
const SCOPE_PATH = new URL(SCOPE).pathname;
const EXTRA = ['manifest.webmanifest', 'assets/icons/icon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/apple-touch-icon.png']
  .map((p) => new URL(p, SCOPE).href);
const NAV_TIMEOUT = 3500;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(fetch(SCOPE, { cache: 'no-cache' }).then(saveShell).catch(() => { /* sem internet: guarda na próxima abertura */ }));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('forja-app-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

// Guarda a página e tudo o que ela usa. Só troca a página guardada depois que todos os arquivos
// da versão nova estão no aparelho: a cópia offline nunca aponta para um arquivo que falta.
async function saveShell(res) {
  if (!res || !res.ok) return;
  const html = await res.clone().text();
  const cache = await caches.open(CACHE);
  const old = await cache.match(SCOPE);
  if (old && (await old.text()) === html) return; // mesma versão: nada a fazer
  const needed = new Set();
  html.replace(/(?:src|href)="([^"#]+\?v=[^"]+)"/g, (_, u) => needed.add(new URL(u, SCOPE).href));
  for (const url of needed) {
    if (await cache.match(url)) continue;
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    await cache.put(url, r);
  }
  // Ícones e manifest não têm ?v=: são renovados a cada versão nova da página
  for (const url of EXTRA) {
    try { const r = await fetch(url, { cache: 'no-cache' }); if (r.ok) await cache.put(url, r); } catch (e) { /* fica o que já tinha */ }
  }
  // Resposta que passou por redirecionamento não pode abrir uma página: guarda uma cópia limpa
  const page = res.redirected ? new Response(html, { status: 200, headers: res.headers }) : res;
  await cache.put(SCOPE, page);
  // Arquivos de versões antigas saem do aparelho
  const keep = new Set([SCOPE, ...needed, ...EXTRA]);
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  const path = url.pathname.slice(SCOPE_PATH.length);
  if (req.mode === 'navigate') {
    if (path === '' || path === 'index.html') e.respondWith(openPage(e));
    return;
  }
  if (/^(js|css|assets)\//.test(path) || path === 'manifest.webmanifest') e.respondWith(fromDevice(req));
});

async function openPage(e) {
  const network = fetch(e.request);
  // Com internet, atualiza a cópia guardada sem atrasar a abertura
  e.waitUntil(network.then((res) => saveShell(res.clone())).catch(() => {}));
  const saved = await caches.match(SCOPE);
  if (!saved) return network;
  const slow = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT, null));
  try {
    const res = await Promise.race([network, slow]);
    if (res && res.ok) return res;
  } catch (err) { /* sem internet */ }
  return saved;
}

async function fromDevice(req) {
  const saved = await caches.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok && new URL(req.url).searchParams.has('v')) {
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
  }
  return res;
}

// Tocar na notificação: volta para o FORJA aberto ou abre uma janela nova
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
