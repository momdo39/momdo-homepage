(() => {
  const launcher = document.getElementById('menu-guide-launcher');
  const panel = document.getElementById('menu-guide-panel');
  const closeBtn = document.getElementById('menu-guide-close');
  const messages = document.getElementById('menu-guide-messages');
  const form = document.getElementById('menu-guide-form');
  const input = document.getElementById('menu-guide-input');
  const suggestions = document.getElementById('menu-guide-suggestions');
  const status = document.getElementById('menu-guide-status');
  if (!launcher || !panel || !closeBtn || !messages || !form || !input) return;

  const endpoint = document.body.dataset.menuGuideApi || '';
  const unconfigured = !endpoint || endpoint.includes('YOUR-WORKER-NAME') || endpoint.includes('YOUR-SUBDOMAIN');
  const history = [];

  function setOpen(open) {
    panel.hidden = !open;
    panel.setAttribute('aria-modal', open ? 'true' : 'false');
    launcher.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }
  function addMessage(text, role) {
    const bubble = document.createElement('div');
    bubble.className = 'menu-guide-message menu-guide-message--' + role;
    bubble.textContent = text;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }
  async function send(text) {
    const question = String(text || '').trim();
    if (!question || question.length > 500) return;
    input.value = '';
    if (suggestions) suggestions.hidden = true;
    addMessage(question, 'user');
    history.push({ role: 'user', content: question });
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    input.disabled = true;
    status.textContent = '回答を準備しています';
    if (unconfigured) {
      await new Promise(resolve => setTimeout(resolve, 250));
      addMessage('AIとの接続設定がまだ完了していません。相談画面は準備できています。AIの回答を有効にするには、サーバー側の接続設定が必要です。', 'assistant');
      status.textContent = 'AI接続設定が未完了です';
    } else {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: question, history: history.slice(-12) })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const reply = typeof data.reply === 'string' ? data.reply : typeof data.response === 'string' ? data.response : '';
        if (!reply) throw new Error('Empty reply');
        addMessage(reply, 'assistant');
        history.push({ role: 'assistant', content: reply });
        status.textContent = '回答が届きました';
      } catch (error) {
        addMessage('現在、AIへの接続ができませんでした。時間をおいて再度お試しください。', 'assistant');
        status.textContent = '接続できませんでした';
      }
    }
    if (submit) submit.disabled = false;
    input.disabled = false;
    input.focus();
  }
  launcher.addEventListener('click', () => setOpen(panel.hidden));
  closeBtn.addEventListener('click', () => setOpen(false));
  form.addEventListener('submit', event => { event.preventDefault(); send(input.value); });
  if (suggestions) suggestions.querySelectorAll('[data-question]').forEach(button => {
    button.addEventListener('click', () => send(button.dataset.question || button.textContent));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });
})();