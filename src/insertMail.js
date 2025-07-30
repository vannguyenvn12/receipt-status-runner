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

      // *** Ghi log trước khi update:
      // 🔍 1. Truy vấn dữ liệu hiện tại từ bảng uscis
      const [[currentData]] = await pool.query(
        `SELECT action_desc, status_en, status_vi, notice_date, response_json, has_receipt, retries, form_info 
   FROM uscis 
   WHERE receipt_number = ?`,
        [receipt]
      );

      // 🔁 2. Ghi log dữ liệu cũ trước khi update
      const logValuesBeforeUpdate = [
        receipt,
        recipient_email,
        currentData?.action_desc ?? null,
        currentData?.status_en ?? null,
        currentData?.status_vi ?? null,
        currentData?.notice_date ?? null,
        currentData?.response_json ?? null,
        currentData?.has_receipt ?? null,
        currentData?.retries ?? null,
        currentData?.form_info ?? null,
      ].map((v) => (v === undefined ? null : v));

      await pool.query(
        `INSERT INTO status_log (
     updated_at_log, receipt_number, email, updated_at_status,
     action_desc, status_en, status_vi, notice_date, response_json,
     has_receipt, retries, form_info
   )
   VALUES (NOW(), ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`,
        logValuesBeforeUpdate
      );

      // *** Update status trong uscis
      const conn2 = await pool.getConnection();
      await conn2.execute(
        `UPDATE uscis 
         SET action_desc = ?, status_en = ?, status_vi = ?, updated_at = NOW() 
         WHERE receipt_number = ?`,
        [statusInfo.action_desc, statusInfo.status_en, status_vi, receipt]
      );
      conn2.release();

      console.log('*** Debug', {
        receipt,
        recipient_email,
        action_desc: statusInfo.action_desc,
        status_en: statusInfo.status_en,
        status_vi,
        notice_date: statusInfo.notice_date,
        raw: JSON.stringify(statusInfo.raw_response),
        form_info: statusInfo.form_info,
      });

      console.log(`✅ USCIS status updated for ${receipt}`);
      console.log(`✅ USCIS status updated to status ${statusInfo.status_en}`);
      console.log(`✅ USCIS status updated to status ${status_vi}`);
    }
  } catch (err) {
    console.error('❌ Error inserting email:', err);
  }
}

module.exports = insertEmailToDB;
