'use strict';

/**
 * In-memory mailbox store with TTL-based expiration.
 * Keeps the service ringan (no database) — perfect for ephemeral inboxes.
 */
class MailStore {
  constructor({ ttlMs = 60 * 60 * 1000, maxPerInbox = 50 } = {}) {
    this.ttlMs = ttlMs;
    this.maxPerInbox = maxPerInbox;
    /** @type {Map<string, Array<object>>} */
    this.inboxes = new Map();
    this.listeners = new Set();

    this._sweeper = setInterval(() => this.sweep(), 60 * 1000);
    if (this._sweeper.unref) this._sweeper.unref();
  }

  _key(address) {
    return String(address || '').trim().toLowerCase();
  }

  add(address, mail) {
    const key = this._key(address);
    if (!key) return;
    const list = this.inboxes.get(key) || [];
    list.unshift(mail);
    if (list.length > this.maxPerInbox) list.length = this.maxPerInbox;
    this.inboxes.set(key, list);
    for (const fn of this.listeners) {
      try { fn(key, mail); } catch (_) { /* ignore */ }
    }
  }

  list(address) {
    const list = this.inboxes.get(this._key(address)) || [];
    return list.map(({ html, text, ...meta }) => meta);
  }

  get(address, id) {
    const list = this.inboxes.get(this._key(address)) || [];
    return list.find((m) => m.id === id) || null;
  }

  delete(address, id) {
    const key = this._key(address);
    const list = this.inboxes.get(key);
    if (!list) return false;
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }

  clear(address) {
    return this.inboxes.delete(this._key(address));
  }

  sweep() {
    const now = Date.now();
    for (const [key, list] of this.inboxes) {
      const filtered = list.filter((m) => now - m.receivedAt < this.ttlMs);
      if (filtered.length === 0) this.inboxes.delete(key);
      else if (filtered.length !== list.length) this.inboxes.set(key, filtered);
    }
  }

  onNew(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

module.exports = { MailStore };
