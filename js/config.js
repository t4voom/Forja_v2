/* FORJA — configuração
   Troque aqui para ligar o Google Planilhas. Veja backend/LEIA-ME.md para criar a planilha e o Apps Script. */
window.FORJA_CONFIG = {
  // 'local'  → contas e dados só neste aparelho (localStorage). Bom para testar.
  // 'sheets' → contas e dados no Google Planilhas, via Apps Script. O localStorage vira cache offline.
  backend: 'sheets',

  // URL do "App da Web" do Apps Script (termina em /exec). Só usada com backend: 'sheets'.
  sheetsUrl: 'https://script.google.com/macros/s/AKfycbyseTrpWlXLRHlRPvuCsrX05Vhd8KtYvLnUW9EWoxI7mf7u0-Poqo70ne5Htt-czRUZxQ/exec',

  // Preços exibidos na tela de planos (o pagamento ainda é simulado)
  price: { monthly: 9.90, yearly: 79.90 },

  // O que o plano Free permite
  freeLimits: { workouts: 3 },

  // Espera depois da última alteração antes de enviar para a planilha (ms)
  syncDelayMs: 2500
};
