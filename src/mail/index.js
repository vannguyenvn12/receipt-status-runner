const Imap = require('node-imap');
const { simpleParser } = require('mailparser');
const insertEmailToDB = require('../insertMail');
const isForwardedChangeEmail = require('../functions/isForwardedChangeEmail');
const pool = require('../db/db');
require('dotenv').config();

let imap; // Global để tái sử dụng
let reconnectTimeout = null;

function createImapConnection() {
  imap = new Imap({
    user: process.env.MAIL_USER,
    password: process.env.MAIL_PASS,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
  });

  imap.once('ready', () => {
    console.log('✅ IMAP Connected');
    openInbox((err, box) => {
      if (err) return console.error('❌ openInbox error:', err);

      imap.on('mail', () => {
        const fetch = imap.seq.fetch(`${box.messages.total}:*`, {
          bodies: '',
          struct: true,
        });

        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream, async (err, parsed) => {
              if (err) return console.error('❌ Parse error:', err);
              console.log('📧 New Email:', {
                from: parsed.from.text,
                to: parsed.to.text,
                subject: parsed.subject,
                date: parsed.date,
                body: parsed.text,
              });

              if (isForwardedChangeEmail(parsed)) {
                await insertEmailToDB(parsed);
              }
            });
          });
        });
      });

      imap.search(
        ['ALL', ['SINCE', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)]],
        (err, results) => {
          if (err || !results.length) return;

          const fetch = imap.fetch(results.slice(-100), {
            bodies: '',
            struct: true,
          });

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, async (err, parsed) => {
                if (err) return;

                const [[existing]] = await pool.query(
                  `SELECT id FROM email_uscis WHERE message_id = ? LIMIT 1`,
                  [parsed.messageId]
                );
                if (existing) {
                  console.log(
                    `⏭ [RETRY SKIP] Đã xử lý rồi: ${parsed.subject} – ${parsed.messageId}`
                  );
                  return;
                }

                if (isForwardedChangeEmail(parsed)) {
                  console.log(
                    `🔁 [RETRY PROCESS] Xử lý lại mail: ${parsed.subject} – ${parsed.messageId}`
                  );
                  await insertEmailToDB(parsed);
                } else {
                  console.log(
                    `❌ [RETRY IGNORED] Không phải mail forward hợp lệ: ${parsed.subject}`
                  );
                }
              });
            });
          });
        }
      );
    });
  });

  imap.once('error', (err) => {
    console.error('❌ IMAP error:', err);
    reconnectWithDelay();
  });

  imap.once('end', () => {
    console.warn('📴 IMAP connection ended');
    reconnectWithDelay();
  });

  imap.connect();
}

function openInbox(cb) {
  imap.openBox('INBOX', false, cb);
}

function reconnectWithDelay(delay = 5000) {
  if (reconnectTimeout) return; // tránh reconnect nhiều lần

  console.log(`🔁 Đang thử reconnect IMAP sau ${delay / 1000}s...`);
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    createImapConnection();
  }, delay);
}

// 🔌 Lần đầu chạy
createImapConnection();
