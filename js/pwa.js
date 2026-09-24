/* FORJA — app instalável e funcionando sem internet
   · Registra o service worker (sw.js), que guarda o app no aparelho para ele abrir sem internet.
   · "Instalar o FORJA" (Perfil › Dados): no Android/Chrome abre o convite de instalação do sistema.
     No iPhone esse convite não existe: a folha mostra o caminho (Compartilhar › Adicionar à Tela de Início).
     Com o app instalado (aberto pelo ícone), a opção some. */
(function (global) {
  'use strict';
  const { U, UI } = global;
  const { h, icon } = U;
  let invite = null; // convite de instalação do Chrome, guardado para o botão do Perfil

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    global.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* segue sem modo offline */ }); });
  }

  // Sem a barra automática do Chrome por cima das telas: a instalação fica no Perfil
  global.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); invite = e; refreshProfile(); });
  global.addEventListener('appinstalled', () => { invite = null; refreshProfile(); });

  function refreshProfile() {
    const R = global.App && global.App.Router;
    if (R && R.current() && R.current().route === 'profile') R.refresh();
  }

  const installed = () => navigator.standalone === true || global.matchMedia('(display-mode: standalone)').matches;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = () => /android/i.test(navigator.userAgent);
  // Aparece onde dá para instalar: convite do Chrome disponível, iPhone/iPad ou Android
  const canOffer = () => !installed() && (!!invite || isIOS() || isAndroid());

  async function install() {
    if (!invite) return openHelp();
    const e = invite;
    invite = null;
    e.prompt();
    const choice = await e.userChoice.catch(() => ({}));
    if (choice.outcome === 'accepted') UI.toast('FORJA instalado. Abra pelo ícone da tela inicial.', { duration: 4500 });
    refreshProfile();
  }

  const STEPS = {
    ios: {
      title: 'Instalar no iPhone',
      subtitle: 'Abra o FORJA no Safari e siga os passos.',
      steps: [
        `Toque em <b>Compartilhar</b> <span class="install-glyph">${icon('share', { size: 16, stroke: 2 })}</span> na barra do Safari.`,
        'Role a lista e toque em <b>Adicionar à Tela de Início</b>.',
        'Toque em <b>Adicionar</b>. Depois, abra o FORJA pelo ícone e entre com a sua conta.'
      ]
    },
    other: {
      title: 'Instalar o FORJA',
      subtitle: 'Leva poucos segundos.',
      steps: [
        `Toque no menu do navegador <span class="install-glyph is-vertical">${icon('more', { size: 16, stroke: 2 })}</span>.`,
        'Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.',
        'Confirme. O FORJA aparece na tela inicial, como os outros apps.'
      ]
    }
  };

  function openHelp() {
    const c = isIOS() ? STEPS.ios : STEPS.other;
    const body = h(`
      <ol class="install-steps">
        ${c.steps.map((s, i) => `<li><span class="install-num">${i + 1}</span><span>${s}</span></li>`).join('')}
      </ol>`);
    const footer = h('<button type="button" class="btn btn-primary btn-block">Entendi</button>');
    const sheet = UI.openSheet({ title: c.title, subtitle: c.subtitle, body, footer });
    footer.addEventListener('click', () => sheet.close('done'));
  }

  /* ---------- Versão nova publicada ----------
     O app instalado (principalmente no iPhone) fica aberto em segundo plano e, ao voltar para ele,
     a página não recarrega: sem isto, a versão nova só apareceria quando o sistema fechasse o app. */
  const version = () => ((document.querySelector('script[src*="?v="]') || {}).src || '').split('?v=')[1] || '';
  let lastCheck = Date.now();
  let offered = '';

  async function checkForUpdate() {
    if (Date.now() - lastCheck < 60000 || navigator.onLine === false || !/^https?:$/.test(location.protocol)) return;
    lastCheck = Date.now();
    try {
      const html = await (await fetch(location.pathname, { cache: 'no-cache' })).text();
      const latest = (html.match(/\?v=([0-9a-z]+)/i) || [])[1];
      if (!latest || latest === version() || latest === offered) return;
      offered = latest;
      UI.toast('Nova versão do FORJA disponível.', { iconName: 'sparkle', action: 'Atualizar', onAction: () => location.reload(), duration: 12000 });
    } catch (e) { /* sem internet: confere na próxima vez */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  global.addEventListener('online', checkForUpdate);

  global.PWA = { canOffer, install, installed, checkForUpdate };
})(window);
