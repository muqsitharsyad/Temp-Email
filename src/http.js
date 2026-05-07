'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

function createHttpServer({ store, domains, basePath = '', provider = 'smtp', logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb' }));

  // Mount everything on a router so the whole app can live under a sub-path
  // (useful when served behind a reverse proxy like /dockdock/temp-number/).
  const router = express.Router();

  // ---- API ----
  router.get('/api/config', (_req, res) => {
    res.json({ provider, domains: provider === 'smtp' ? domains : [], basePath });
  });

  router.get('/api/random', (_req, res) => {
    const localPart = crypto.randomBytes(5).toString('hex');
    const domain = domains[Math.floor(Math.random() * domains.length)];
    res.json({ address: `${localPart}@${domain}` });
  });

  router.get('/api/inbox/:address', (req, res) => {
    const address = String(req.params.address || '').toLowerCase();
    if (!isValidAddress(address, domains)) return res.status(400).json({ error: 'invalid address' });
    res.json({ address, messages: store.list(address) });
  });

  router.get('/api/inbox/:address/:id', (req, res) => {
    const address = String(req.params.address || '').toLowerCase();
    if (!isValidAddress(address, domains)) return res.status(400).json({ error: 'invalid address' });
    const mail = store.get(address, req.params.id);
    if (!mail) return res.status(404).json({ error: 'not found' });
    res.json(mail);
  });

  router.delete('/api/inbox/:address/:id', (req, res) => {
    const address = String(req.params.address || '').toLowerCase();
    if (!isValidAddress(address, domains)) return res.status(400).json({ error: 'invalid address' });
    const ok = store.delete(address, req.params.id);
    res.json({ ok });
  });

  router.delete('/api/inbox/:address', (req, res) => {
    const address = String(req.params.address || '').toLowerCase();
    if (!isValidAddress(address, domains)) return res.status(400).json({ error: 'invalid address' });
    store.clear(address);
    res.json({ ok: true });
  });

  // Static UI — inject runtime config into index.html
  const publicDir = path.join(__dirname, '..', 'public');
  router.get(['/', '/index.html'], (_req, res) => {
    const fs = require('fs');
    let html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const cfg = `<script>window.__APP_CONFIG__=${JSON.stringify({ basePath })};</script>`;
    html = html.replace('</head>', `${cfg}</head>`);
    res.type('html').send(html);
  });
  router.use(express.static(publicDir));

  // Mount router under basePath ('' or '/dockdock/temp-number')
  if (basePath) {
    // Redirect bare basePath without trailing slash so relative URLs resolve
    app.get(basePath, (_req, res) => res.redirect(basePath + '/'));
    app.use(basePath, router);
  } else {
    app.use(router);
  }

  const server = http.createServer(app);

  // ---- WebSocket for real-time push ----
  const wsPath = (basePath || '') + '/ws';
  const wss = new WebSocketServer({ server, path: wsPath });

  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const subs = new Map();

  wss.on('connection', (ws) => {
    /** @type {Set<string>} */
    const mine = new Set();

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg && msg.type === 'subscribe' && typeof msg.address === 'string') {
        const addr = msg.address.toLowerCase();
        if (!isValidAddress(addr, domains)) return;
        if (!subs.has(addr)) subs.set(addr, new Set());
        subs.get(addr).add(ws);
        mine.add(addr);
      } else if (msg && msg.type === 'unsubscribe' && typeof msg.address === 'string') {
        const addr = msg.address.toLowerCase();
        const set = subs.get(addr);
        if (set) { set.delete(ws); if (set.size === 0) subs.delete(addr); }
        mine.delete(addr);
      }
    });

    ws.on('close', () => {
      for (const addr of mine) {
        const set = subs.get(addr);
        if (!set) continue;
        set.delete(ws);
        if (set.size === 0) subs.delete(addr);
      }
    });
  });

  store.onNew((address, mail) => {
    const set = subs.get(address);
    if (!set) return;
    const { html, text, ...meta } = mail;
    const payload = JSON.stringify({ type: 'mail', address, message: meta });
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  });

  return server;
}

function isValidAddress(addr, domains) {
  if (typeof addr !== 'string') return false;
  const m = /^[a-z0-9._+-]{1,64}@([a-z0-9.-]{1,253})$/i.exec(addr);
  if (!m) return false;
  return domains.includes(m[1].toLowerCase());
}

module.exports = { createHttpServer };
