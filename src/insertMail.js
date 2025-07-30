// src/mail/insertEmail.js
const pool = require('./db/db');
const getReceiptByEmail = require('./functions/getReceiptByEmail');
const getStatus = require('./functions/getStatus');

function extractForwardedRecipient(emailBody) {
  const match = emailBody.match(/To:\s*<?([^>\n\r]+)>?/i);
  return match ? match[1].trim() : null;
}

// Hàm trích xuất dữ liệu từ nội dung forwarded
function extractForwardedData(body) {
  const lines = body.split('\n').map((line) => line.trim());
  const fromLine = lines.find((line) => line.startsWith('Từ:'));
  const dateLine = lines.find((line) => line.startsWith('Date:'));

  const sender_email = fromLine?.match(/<(.+?)>/)?.[1] || null;
  const sent_time_raw = dateLine || null;

  return { sender_email, sent_time_raw };
}

async function insertEmailToDB(parsed) {
  const {
    from: { text: from },
    to,
    subject,
    date,
    text: email_body,
  } = parsed;

  const sender_match = from.match(/"?(.*?)"?\s*<(.+?)>/);
  const sender = sender_match?.[1] || null;
  const receiver = to;
  const forwarded_date = new Date(date);
  const { sender_email, sent_time_raw } = extractForwardedData(email_body);
  const recipient_email = extractForwardedRecipient(email_body);

  const sql = `
    INSERT INTO email_uscis 
      (forwarded_date, sender, receiver, subject, email_body, sender_email, sent_time_raw, recipient_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    forwarded_date,
    sender,
    receiver,
    subject,
    email_body,
    sender_email,
    sent_time_raw,
    recipient_email,
  ];

  try {
    const conn = await pool.getConnection();
    await conn.execute(sql, values);
    conn.release();
    console.log('✅ Email inserted into database');

    const receipt = await getReceiptByEmail(recipient_email);
    console.log('receipt', receipt);
    if (receipt) {
      let statusInfo = await getStatus(receipt);
      if (statusInfo.wait) {
        console.log(`⏸ Server yêu cầu đợi... nghỉ 1 phút cho ${receipt}`);
        await new Promise((res) => setTimeout(res, 60000)); // 60 giây
        statusInfo = await getStatus(receipt); // gọi lại
      }

      // 🔎 Lấy status_vi từ mapping
      const [[map]] = await pool.query(
        `SELECT vietnamese_status FROM setting_uscis_phase_group WHERE english_status = ?`,
        [statusInfo.status_en]
      );

      const status_vi = map?.vietnamese_status || null;

      const conn2 = await pool.getConnection();
      await conn2.execute(
        `UPDATE uscis 
         SET action_desc = ?, status_en = ?, status_vi = ?, updated_at = NOW() 
         WHERE receipt_number = ?`,
        [statusInfo.action_desc, statusInfo.status_en, status_vi, receipt]
      );
      conn2.release();

      console.log(`✅ USCIS status updated for ${receipt}`);
    }
  } catch (err) {
    console.error('❌ Error inserting email:', err);
  }
}

module.exports = insertEmailToDB;
