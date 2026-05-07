'use strict';

const BASE = (window.__APP_CONFIG__ && window.__APP_CONFIG__.basePath) || '';
const api = (p) => BASE + p;

const $ = (sel) => document.querySelector(sel);
const els = {
  address: $('#address'),
  domain: $('#domain'),
  copyBtn: $('#copyBtn'),
  randomBtn: $('#randomBtn'),
  historyBtn: $('#historyBtn'),
  historyList: $('#historyList'),
  autoNew: $('#autoNew'),
  refreshBtn: $('#refreshBtn'),
  clearBtn: $('#clearBtn'),
  list: $('#messageList'),
  viewer: $('#viewer'),
  liveDot: $('#liveDot'),
  liveText: $('#liveText'),
};

const state = {
  provider: null,
  domains: [],
  address: '',
  messages: [],
  selectedId: null,
  history: [],
  ws: null,
  pollTimer: null,
};

const STORAGE_KEY = 'temp-email:address';
const HISTORY_KEY = 'temp-email:history';
const AUTONEW_KEY = 'temp-email:autoNew';
const HISTORY_MAX = 10;

let provider;

init().catch((err) => { console.error(err); alert('Gagal inisialisasi: ' + err.message); });

async function init() {
  const cfg = await fetch(api('/api/config')).then((r) => r.json());
  state.provider = cfg.provider || 'smtp';
  provider = state.provider === 'mailtm' ? new MailtmProvider() : new SmtpProvider(cfg.domains || []);
  await provider.init();
  state.domains = provider.domains;
  els.domain.innerHTML = state.domains.map((d) => `<option value="${d}">@${d}</option>`).join('');

  state.history = loadHistory().filter((h) => provider.canUse(h));
  saveHistory();
  const autoNew = localStorage.getItem(AUTONEW_KEY) === '1';
  els.autoNew.checked = autoNew;

  const saved = localStorage.getItem(STORAGE_KEY);
  if (autoNew || !saved || !provider.canUse(saved)) {
    await randomize();
  } else {
    await setAddress(saved, { persist: false });
  }

  els.randomBtn.addEventListener('click', randomize);
  els.copyBtn.addEventListener('click', copyAddress);
  els.refreshBtn.addEventListener('click', loadMessages);
  els.clearBtn.addEventListener('click', clearInbox);
  els.historyBtn.addEventListener('click', toggleHistory);
  els.autoNew.addEventListener('change', () => {
    localStorage.setItem(AUTONEW_KEY, els.autoNew.checked ? '1' : '0');
  });
  document.addEventListener('click', (e) => {
    if (!els.historyList.contains(e.target) && e.target !== els.historyBtn) {
      els.historyList.classList.add('hidden');
    }
  });

  if (provider.allowManualAddress) {
    els.address.addEventListener('change', () => setAddress(buildFromInputs()));
    els.address.addEventListener('blur', () => setAddress(buildFromInputs()));
    els.domain.addEventListener('change', () => setAddress(buildFromInputs()));
  } else {
    els.address.readOnly = true;
    els.domain.disabled = true;
    els.address.title = 'Mode Mail.tm: pakai tombol "Baru" untuk membuat alamat acak.';
  }

  provider.startRealtime(setLive);
}

// ---------------------------------------------------------------------
// SMTP provider — talks to our own backend.
// ---------------------------------------------------------------------
class SmtpProvider {
  constructor(domains) {
    this.domains = domains;
    this.allowManualAddress = true;
  }
  async init() {}
  canUse(addr) {
    const m = /^[a-z0-9._+-]{1,64}@([a-z0-9.-]+)$/i.exec(String(addr || ''));
    return !!m && this.domains.includes(m[1].toLowerCase());
  }
  async randomAddress() {
    const { address } = await fetch(api('/api/random')).then((r) => r.json());
    return address;
  }
  async list(addr) {
    const r = await fetch(api(`/api/inbox/${encodeURIComponent(addr)}`));
    if (!r.ok) return [];
    const d = await r.json();
    return d.messages || [];
  }
  async get(addr, id) {
    const r = await fetch(api(`/api/inbox/${encodeURIComponent(addr)}/${id}`));
    if (!r.ok) return null;
    return r.json();
  }
  async del(addr, id) {
    await fetch(api(`/api/inbox/${encodeURIComponent(addr)}/${id}`), { method: 'DELETE' });
  }
  async clear(addr) {
    await fetch(api(`/api/inbox/${encodeURIComponent(addr)}`), { method: 'DELETE' });
  }
  startRealtime(setLive) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const open = () => {
      const ws = new WebSocket(`${proto}://${location.host}${BASE}/ws`);
      state.ws = ws;
      setLive('connecting');
      ws.addEventListener('open', () => { setLive('live'); this._resub(); });
      ws.addEventListener('close', () => { setLive('off'); setTimeout(open, 2000); });
      ws.addEventListener('error', () => setLive('off'));
      ws.addEventListener('message', (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'mail' && msg.address === state.address) onIncomingMail(msg.message);
      });
    };
    open();
  }
  onAddressChanged() { this._resub(); }
  _resub() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.address) return;
    state.ws.send(JSON.stringify({ type: 'subscribe', address: state.address }));
  }
}

// ---------------------------------------------------------------------
// Mail.tm provider — calls https://api.mail.tm directly (CORS-enabled).
// Per-address credentials are kept in localStorage on this browser.
// ---------------------------------------------------------------------
class MailtmProvider {
  constructor() {
    this.api = 'https://api.mail.tm';
    this.allowManualAddress = false;
    this.domains = [];
    this._accountsKey = 'temp-email:mailtm:accounts';
    this._pollMs = 8000;
  }
  async init() {
    const r = await fetch(`${this.api}/domains?page=1`);
    if (!r.ok) throw new Error('Gagal mengambil daftar domain mail.tm');
    const data = await r.json();
    const list = data['hydra:member'] || data.member || [];
    this.domains = list.filter((d) => d.isActive !== false).map((d) => d.domain);
    if (this.domains.length === 0) throw new Error('Tidak ada domain aktif di mail.tm');
  }
  _accounts() {
    try { return JSON.parse(localStorage.getItem(this._accountsKey) || '{}'); }
    catch { return {}; }
  }
  _saveAccounts(map) {
    localStorage.setItem(this._accountsKey, JSON.stringify(map));
  }
  canUse(addr) {
    const m = /^[a-z0-9._+-]{1,64}@([a-z0-9.-]+)$/i.exec(String(addr || ''));
    if (!m) return false;
    if (!this.domains.includes(m[1].toLowerCase())) return false;
    return !!this._accounts()[addr];
  }
  _randomLocal(len = 12) {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  }
  async randomAddress() {
    const domain = this.domains[Math.floor(Math.random() * this.domains.length)];
    const local = this._randomLocal(10);
    const address = `${local}@${domain}`;
    const password = this._randomLocal(16) + 'Aa1!';
    const r = await fetch(`${this.api}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password }),
    });
    if (!r.ok && r.status !== 422) {
      const t = await r.text().catch(() => '');
      throw new Error('Gagal membuat akun mail.tm: ' + r.status + ' ' + t.slice(0, 200));
    }
    const acc = r.ok ? await r.json() : { address };
    const tok = await this._token(address, password);
    const map = this._accounts();
    map[address] = { password, token: tok.token, accountId: acc.id || tok.id };
    this._saveAccounts(map);
    return address;
  }
  async _token(address, password) {
    const r = await fetch(`${this.api}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password }),
    });
    if (!r.ok) throw new Error('Gagal login ke mail.tm');
    return r.json();
  }
  async _fetch(addr, path, init = {}) {
    const map = this._accounts();
    const acc = map[addr];
    if (!acc) throw new Error('Akun untuk ' + addr + ' tidak ada di browser ini.');
    const doFetch = (token) => fetch(this.api + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    let r = await doFetch(acc.token);
    if (r.status === 401) {
      const tok = await this._token(addr, acc.password);
      const m2 = this._accounts();
      m2[addr] = { ...acc, token: tok.token, accountId: tok.id || acc.accountId };
      this._saveAccounts(m2);
      r = await doFetch(tok.token);
    }
    return r;
  }
  async list(addr) {
    const r = await this._fetch(addr, '/messages?page=1');
    if (!r.ok) return [];
    const d = await r.json();
    const list = d['hydra:member'] || d.member || [];
    return list.map((m) => ({
      id: m.id,
      from: m.from && (m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address) || '',
      subject: m.subject || '(no subject)',
      preview: (m.intro || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      receivedAt: new Date(m.createdAt).getTime(),
    }));
  }
  async get(addr, id) {
    const r = await this._fetch(addr, `/messages/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const m = await r.json();
    const html = Array.isArray(m.html) ? m.html.join('') : (m.html || null);
    return {
      id: m.id,
      from: m.from && (m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address) || '',
      to: (m.to || []).map((t) => t.address).join(', '),
      recipient: addr,
      subject: m.subject || '(no subject)',
      text: m.text || '',
      html,
      receivedAt: new Date(m.createdAt).getTime(),
    };
  }
  async del(addr, id) {
    await this._fetch(addr, `/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  async clear(addr) {
    const list = await this.list(addr);
    await Promise.all(list.map((m) => this.del(addr, m.id)));
  }
  startRealtime(setLive) {
    setLive('polling');
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => this._poll(), this._pollMs);
  }
  onAddressChanged() {
    this._lastIds = new Set(state.messages.map((m) => m.id));
  }
  async _poll() {
    if (!state.address) return;
    try {
      const list = await this.list(state.address);
      const known = this._lastIds || new Set(state.messages.map((m) => m.id));
      const fresh = list.filter((m) => !known.has(m.id));
      for (const m of fresh) onIncomingMail(m);
      this._lastIds = new Set(list.map((m) => m.id));
    } catch (_) { /* ignore */ }
  }
}

// =====================================================================
// Generic UI flow
// =====================================================================
function buildFromInputs() {
  const raw = els.address.value.trim().toLowerCase();
  if (raw.includes('@')) return raw;
  return `${raw || randomLocal()}@${els.domain.value}`;
}
function randomLocal() { return Math.random().toString(36).slice(2, 12); }

async function randomize() {
  try {
    flash(els.randomBtn, '…');
    const address = await provider.randomAddress();
    await setAddress(address);
  } catch (e) {
    alert('Gagal membuat alamat baru: ' + e.message);
  }
}

async function setAddress(addr, opts = {}) {
  if (!provider.canUse(addr)) {
    alert('Alamat tidak valid atau tidak tersedia di sesi browser ini.');
    if (state.address) els.address.value = state.address.split('@')[0];
    return;
  }
  state.address = addr;
  const [local, domain] = addr.split('@');
  els.address.value = local;
  if ([...els.domain.options].some((o) => o.value === domain)) {
    els.domain.value = domain;
  } else {
    const opt = document.createElement('option');
    opt.value = domain; opt.textContent = '@' + domain;
    els.domain.appendChild(opt);
    els.domain.value = domain;
  }
  if (opts.persist !== false) localStorage.setItem(STORAGE_KEY, addr);
  pushHistory(addr);
  state.selectedId = null;
  state.messages = [];
  renderViewerPlaceholder();
  await loadMessages();
  if (provider.onAddressChanged) provider.onAddressChanged();
}

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(state.address);
    flash(els.copyBtn, 'Tersalin');
  } catch {
    prompt('Salin alamat:', state.address);
  }
}

function flash(btn, text) {
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = orig), 1200);
}

async function loadMessages() {
  if (!state.address) return;
  state.messages = await provider.list(state.address);
  renderList();
}

function renderList() {
  if (state.messages.length === 0) {
    els.list.innerHTML = '<li class="empty">Belum ada email. Silakan tunggu…</li>';
    return;
  }
  els.list.innerHTML = state.messages.map((m) => `
    <li class="item ${m.id === state.selectedId ? 'active' : ''}" data-id="${m.id}">
      <span class="time">${formatTime(m.receivedAt)}</span>
      <div class="from">${escapeHtml(m.from || '(unknown)')}</div>
      <div class="subject">${escapeHtml(m.subject || '(no subject)')}</div>
      <div class="preview">${escapeHtml(m.preview || '')}</div>
    </li>
  `).join('');
  els.list.querySelectorAll('li.item').forEach((li) => {
    li.addEventListener('click', () => openMessage(li.dataset.id));
  });
}

async function openMessage(id) {
  state.selectedId = id;
  renderList();
  const mail = await provider.get(state.address, id);
  if (mail) renderMail(mail);
}

function renderMail(mail) {
  const otps = extractOtps(mail.text || stripHtml(mail.html || ''));
  const otpHtml = otps.length
    ? `<div class="otps">${otps.map((o) => `<button class="otp" data-otp="${o}" title="Klik untuk salin">${o}</button>`).join('')}</div>`
    : '';

  const bodyHtml = mail.html
    ? `<iframe sandbox srcdoc="${escapeAttr(mail.html)}"></iframe>`
    : `<pre>${escapeHtml(mail.text || '(empty body)')}</pre>`;

  els.viewer.innerHTML = `
    <article class="mail">
      <h2>${escapeHtml(mail.subject || '(no subject)')}</h2>
      <div class="meta">
        <div><b>Dari:</b> ${escapeHtml(mail.from || '')}</div>
        <div><b>Untuk:</b> ${escapeHtml(mail.to || mail.recipient || '')}</div>
        <div><b>Diterima:</b> ${new Date(mail.receivedAt).toLocaleString()}</div>
      </div>
      ${otpHtml}
      <div class="actions">
        <button id="deleteBtn">Hapus pesan</button>
      </div>
      <div class="body">${bodyHtml}</div>
    </article>
  `;

  els.viewer.querySelectorAll('.otp').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.otp); flash(b, 'Tersalin'); }
      catch { /* noop */ }
    });
  });
  $('#deleteBtn').addEventListener('click', async () => {
    await provider.del(state.address, mail.id);
    state.selectedId = null;
    renderViewerPlaceholder();
    loadMessages();
  });
}

function renderViewerPlaceholder() {
  els.viewer.innerHTML = `
    <div class="placeholder">
      <h2>Inbox: ${escapeHtml(state.address || '-')}</h2>
      <p>Pesan baru akan otomatis muncul di kolom kiri.</p>
      ${state.provider === 'mailtm'
        ? '<p class="hint">Mode <b>Mail.tm</b> (layanan publik). Inbox dipoll setiap beberapa detik.</p>'
        : ''}
    </div>`;
}

function onIncomingMail(message) {
  if (state.messages.some((m) => m.id === message.id)) return;
  state.messages.unshift(message);
  if (state.messages.length > 100) state.messages.length = 100;
  renderList();
  try { new Notification('Email baru', { body: message.subject || '' }); } catch {}
}

async function clearInbox() {
  if (!confirm('Kosongkan inbox?')) return;
  await provider.clear(state.address);
  state.selectedId = null;
  state.messages = [];
  renderViewerPlaceholder();
  loadMessages();
}

// ---- history ----
function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}
function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, HISTORY_MAX)));
}
function pushHistory(addr) {
  state.history = [addr, ...state.history.filter((a) => a !== addr)].slice(0, HISTORY_MAX);
  saveHistory();
  renderHistory();
}
function removeHistory(addr) {
  state.history = state.history.filter((a) => a !== addr);
  saveHistory();
  renderHistory();
}
function toggleHistory() {
  renderHistory();
  els.historyList.classList.toggle('hidden');
}
function renderHistory() {
  if (state.history.length === 0) {
    els.historyList.innerHTML = '<li class="empty">Belum ada riwayat</li>';
    return;
  }
  els.historyList.innerHTML = state.history.map((a) => `
    <li data-addr="${escapeAttr(a)}">
      <span class="addr" title="${escapeAttr(a)}">${escapeHtml(a)}</span>
      <button data-act="del" title="Hapus dari riwayat">✕</button>
    </li>
  `).join('');
  els.historyList.querySelectorAll('li[data-addr]').forEach((li) => {
    const addr = li.dataset.addr;
    li.addEventListener('click', (e) => {
      if (e.target.dataset.act === 'del') {
        e.stopPropagation();
        removeHistory(addr);
        return;
      }
      setAddress(addr);
      els.historyList.classList.add('hidden');
    });
  });
}

// ---- status ----
function setLive(s) {
  els.liveDot.classList.remove('live', 'off');
  if (s === 'live') { els.liveDot.classList.add('live'); els.liveText.textContent = 'realtime'; }
  else if (s === 'polling') { els.liveDot.classList.add('live'); els.liveText.textContent = 'polling'; }
  else if (s === 'off') { els.liveDot.classList.add('off'); els.liveText.textContent = 'terputus'; }
  else { els.liveText.textContent = 'menghubungkan…'; }
}

// ---- helpers ----
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
function stripHtml(html) { return String(html).replace(/<[^>]+>/g, ' '); }

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString();
}

function extractOtps(text) {
  if (!text) return [];
  const found = new Set();
  const patterns = [
    /\b\d{4,8}\b/g,
    /\b[A-Z0-9]{6,8}\b/g,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) m.forEach((v) => found.add(v));
  }
  return [...found].slice(0, 5);
}

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission().catch(() => {});
}
