const pool = require('./db/db');
const getReceiptByEmail = require('./functions/getReceiptByEmail');
const getStatus = require('./functions/getStatus');

function extractForwardedRecipient(emailBody) {
  const match = emailBody.match(/To:\s*<?([^>\n\r]+)>?/i);
  return match ? match[1].trim() : null;
}

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
    if (!receipt) {
      console.warn(`⚠️ Không tìm thấy receipt cho ${recipient_email}`);
      return;
    }

    // 🌀 Gọi getStatus với retry nếu wait
    let statusInfo;
    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      statusInfo = await getStatus(receipt);
      if (!statusInfo.wait) break;

      console.log(
        `⏸ Server yêu cầu đợi... nghỉ 1 phút cho ${receipt} (lần ${
          retries + 1
        })`
      );
      await new Promise((res) => setTimeout(res, 60000));
      retries++;
    }

    // Sau retry mà vẫn wait hoặc lỗi thì bỏ qua
    if (statusInfo.wait || statusInfo.error || !statusInfo.status_en) {
      console.warn(
        `⚠️ Không thể lấy trạng thái hợp lệ sau ${retries} lần cho ${receipt}`
      );
      return;
    }

    // 🔎 Lấy status_vi từ mapping
    const [[map]] = await pool.query(
      `SELECT vietnamese_status FROM setting_uscis_phase_group WHERE english_status = ?`,
      [statusInfo.status_en]
    );
    const status_vi = map?.vietnamese_status || null;

    // 🔍 Lấy dữ liệu hiện tại từ uscis
    const [[currentData]] = await pool.query(
      `SELECT action_desc, status_en, status_vi, notice_date, response_json, has_receipt, retries, form_info 
       FROM uscis 
       WHERE receipt_number = ?`,
      [receipt]
    );

    // Nếu không thay đổi trạng thái thì không cần update
    if (currentData?.status_en === statusInfo.status_en) {
      console.log(`↪️ Không thay đổi trạng thái: ${receipt}`);
      return;
    }

    // Ghi log trước khi update
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

    // Cập nhật bản ghi chính
    const conn2 = await pool.getConnection();
    await conn2.execute(
      `UPDATE uscis 
         SET action_desc = ?, status_en = ?, status_vi = ?, updated_at = NOW() 
         WHERE receipt_number = ?`,
      [statusInfo.action_desc, statusInfo.status_en, status_vi, receipt]
    );
    conn2.release();

    console.log(
      `✅ USCIS status updated for ${receipt} → ${statusInfo.status_en} / ${status_vi}`
    );
  } catch (err) {
    console.error('❌ Error inserting email:', err);
  }
}

module.exports = insertEmailToDB;
