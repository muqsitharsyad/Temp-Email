'use strict';

const { MailStore } = require('./store');
const { createSmtpServer } = require('./smtp');
const { createHttpServer } = require('./http');

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3000', 10);
const HTTP_HOST = process.env.HTTP_HOST || '0.0.0.0';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '25', 10);
const SMTP_HOST = process.env.SMTP_HOST || '0.0.0.0';
const TTL_MINUTES = parseInt(process.env.MAIL_TTL_MINUTES || '60', 10);
const MAX_PER_INBOX = parseInt(process.env.MAX_PER_INBOX || '50', 10);

// 'smtp' (default) = self-hosted SMTP; 'mailtm' = UI-only client of api.mail.tm
const PROVIDER = (process.env.MAIL_PROVIDER || 'smtp').toLowerCase();

// Optional sub-path mount (e.g. "/dockdock/temp-number") for reverse-proxy deploys.
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '');

function normalizeBasePath(p) {
  if (!p) return '';
  let s = String(p).trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

const DOMAINS = (process.env.MAIL_DOMAINS || 'example.test')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

async function main() {
  const store = new MailStore({ ttlMs: TTL_MINUTES * 60 * 1000, maxPerInbox: MAX_PER_INBOX });

  const httpServer = createHttpServer({ store, domains: DOMAINS, basePath: BASE_PATH, provider: PROVIDER });
  await new Promise((resolve, reject) => {
    httpServer.listen(HTTP_PORT, HTTP_HOST, (err) => err ? reject(err) : resolve());
  });
  console.log(`[http] listening on http://${HTTP_HOST}:${HTTP_PORT}${BASE_PATH || ''}/  (provider=${PROVIDER})`);

  if (PROVIDER === 'smtp') {
    await createSmtpServer({ store, domains: DOMAINS, port: SMTP_PORT, host: SMTP_HOST });
  } else {
    console.log('[smtp] disabled (provider=' + PROVIDER + ')');
  }

  const shutdown = (sig) => {
    console.log(`[main] received ${sig}, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[main] fatal', err);
  process.exit(1);
});
