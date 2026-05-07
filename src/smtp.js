'use strict';

const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');

/**
 * Build and start an SMTP server that accepts inbound mail for any address
 * matching the configured DOMAIN(s) and stores it in the provided MailStore.
 */
function createSmtpServer({ store, domains, port = 25, host = '0.0.0.0', size = 10 * 1024 * 1024, logger = console }) {
  const allowed = new Set(domains.map((d) => d.toLowerCase()));

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    size,
    banner: 'Temp-Email SMTP ready',

    onRcptTo(address, _session, callback) {
      const addr = String(address.address || '').toLowerCase();
      const domain = addr.split('@')[1];
      if (!domain || !allowed.has(domain)) {
        return callback(new Error(`550 Mailbox ${addr} not hosted here`));
      }
      callback();
    },

    onData(stream, session, callback) {
      simpleParser(stream, {}, (err, parsed) => {
        if (err) {
          logger.error('[smtp] parse error', err.message);
          return callback(new Error('451 Failed to parse message'));
        }

        const recipients = (session.envelope.rcptTo || [])
          .map((r) => String(r.address || '').toLowerCase())
          .filter((a) => allowed.has(a.split('@')[1]));

        if (recipients.length === 0) return callback();

        const baseMail = {
          id: crypto.randomBytes(8).toString('hex'),
          receivedAt: Date.now(),
          from: parsed.from ? parsed.from.text : (session.envelope.mailFrom && session.envelope.mailFrom.address) || '',
          to: parsed.to ? parsed.to.text : recipients.join(', '),
          subject: parsed.subject || '(no subject)',
          text: parsed.text || '',
          html: parsed.html || null,
          preview: (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 140),
          attachments: (parsed.attachments || []).map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
          })),
        };

        for (const rcpt of recipients) {
          store.add(rcpt, { ...baseMail, id: crypto.randomBytes(8).toString('hex'), recipient: rcpt });
        }
        logger.log(`[smtp] +1 mail from=${baseMail.from} to=${recipients.join(',')} subject=${JSON.stringify(baseMail.subject)}`);
        callback();
      });
    },
  });

  server.on('error', (err) => logger.error('[smtp] server error', err.message));

  return new Promise((resolve, reject) => {
    server.listen(port, host, (err) => {
      if (err) return reject(err);
      logger.log(`[smtp] listening on ${host}:${port} for domains: ${[...allowed].join(', ')}`);
      resolve(server);
    });
  });
}

module.exports = { createSmtpServer };
