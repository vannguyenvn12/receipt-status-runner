const Imap = require('node-imap');
const { simpleParser } = require('mailparser');
const insertEmailToDB = require('../insertMail');
require('dotenv').config();

const imap = new Imap({
  user: process.env.MAIL_USER,
  password: process.env.MAIL_PASS,
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
});

function openInbox(cb) {
  imap.openBox('INBOX', false, cb);
}

imap.once('ready', () => {
  console.log('✅ IMAP Connected');

  openInbox((err, box) => {
    if (err) throw err;

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
            await insertEmailToDB(parsed);
          });
        });
      });
    });
  });
});

imap.once('error', (err) => {
  console.error('❌ IMAP error:', err);
});

imap.once('end', () => {
  console.log('📴 Connection closed');
});

imap.connect();
