const pool = require('./db/db');
const getReceiptByEmail = require('./functions/getReceiptByEmail');
const getStatus = require('./functions/getStatus');
const sendStatusUpdateMail = require('./mail/mailer');
const sendNoEmailStatus = require('./mail/no-mailer');
const { convertVietnameseDateToSQL } = require('./utils/day');

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function extractForwardedRecipient(emailBody) {
  const matches = emailBody.match(/Đến:\s.*<([^>\n\r]+)>/gim);
  if (!matches || matches.length === 0) return null;

  const lastMatch = matches[matches.length - 1];
  const email = lastMatch.match(/<([^>\n\r]+)>/)?.[1];
  return email?.trim() || null;
}

function extractSentDate(emailText) {
  const match = emailText.match(/Đã gửi:\s*(.+)/i);
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

function extractForwardedDataAndRecipient(body) {
  const lines = body.split('\n').map((line) => line.trim());

  let sender_email = null;
  let recipient_email = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    if (!sender_email && /^Từ:.*<.+>$/.test(line)) {
      sender_email = line.match(/<(.+?)>/)?.[1]?.trim() || null;
    }

    if (!recipient_email && /^Đến:.*<.+>$/.test(line)) {
      recipient_email = line.match(/<(.+?)>/)?.[1]?.trim() || null;
    }

    if (!recipient_email && /^Tới:.*<.+?>$/.test(line)) {
      recipient_email = line.match(/<(.+?)>/)?.[1]?.trim() || null;
    }

    if (sender_email && recipient_email) break;
  }

  return { sender_email, recipient_email };
}

async function insertEmailToDB(parsed) {
  const {
    from: { text: from },
    to,
    subject,
    date,
    text: email_body,
    messageId,
  } = parsed;

  const sender_match = from.match(/"?(.*?)"?\s*<(.+?)>/);
  const sender = sender_match?.[1] || null;
  const receiver = to;
  const receiverAddress = receiver.value?.[0]?.address || null;

  const forwarded_date = new Date(date);
  const { sent_time_raw } = extractForwardedData(email_body);
  const { sender_email, recipient_email } =
    extractForwardedDataAndRecipient(email_body);

  const bodyDate = extractSentDate(email_body);
  const sqlDate = convertVietnameseDateToSQL(bodyDate);
  console.log('*** CHECK SQLDATE', sqlDate);

  console.log('*** CHECK EMAIL', {
    receiverAddress,
    sender_email,
  });

  const sql = `
  INSERT INTO email_uscis 
    (message_id, forwarded_date, sender, receiver, subject, email_body, sender_email, sent_time_raw, recipient_email)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

  const values = [
    messageId,
    forwarded_date,
    sender,
    receiverAddress,
    subject,
    email_body,
    sender_email,
    sent_time_raw,
    recipient_email,
  ];

  // ❗ Check nếu messageId đã tồn tại trong DB thì bỏ qua
  const [[exists]] = await pool.query(
    `SELECT id FROM email_uscis WHERE message_id = ? LIMIT 1`,
    [messageId]
  );

  if (exists) {
    console.log(`⚠️ Đã xử lý email có messageId: ${messageId}, bỏ qua.`);
    return;
  }

  try {
    const conn = await pool.getConnection();
    await conn.execute(sql, values);
    conn.release();
    console.log('✅ Email inserted into database');

    const receipts = await getReceiptByEmail(recipient_email);
    console.log('recipient_email', recipient_email);
    console.log('recipient_email', receipts.length);

    if (!receipts || receipts.length === 0) {
      console.warn(`⚠️ Không tìm thấy receipt nào cho ${recipient_email}`);
      await sendNoEmailStatus({
        to: process.env.MAIL_NOTIFY,
        email: recipient_email,
      });
      return;
    }

    for (const receipt of receipts) {
      console.log(`📦 Xử lý receipt: ${receipt}`);

      let statusInfo;
      let retries = 0;
      const maxRetries = 5;

      while (retries < maxRetries) {
        statusInfo = await getStatus(receipt);
        if (!statusInfo.wait) break;

        console.log(
          `⏸ Đợi retry... nghỉ 1 phút cho ${receipt} (lần ${retries + 1})`
        );
        await new Promise((res) => setTimeout(res, 60000));
        retries++;
      }

      if (statusInfo.wait || statusInfo.error || !statusInfo.status_en) {
        console.warn(`⚠️ Không thể lấy trạng thái hợp lệ cho ${receipt}`);
        continue;
      }

      console.log(
        '*** [3. CHECK STATUS INFO > FINAL] ',
        statusInfo.action_desc
      );
      console.log('--------------------------------');

      const [[map]] = await pool.query(
        `SELECT vietnamese_status FROM setting_uscis_phase_group WHERE english_status = ?`,
        [statusInfo.status_en]
      );
      const status_vi = map?.vietnamese_status || null;

      const [[currentData]] = await pool.query(
        `SELECT action_desc, status_en, status_vi, notice_date, response_json, has_receipt, retries, form_info , updated_at
         FROM uscis 
         WHERE receipt_number = ?`,
        [receipt]
      );

      const hasChanged =
        statusInfo.status_en !== currentData.status_en ||
        statusInfo.action_desc !== currentData.action_desc;

      const updatedStatusAt = hasChanged
        ? new Date(
            Date.UTC(
              now.getUTCFullYear(),
              now.getUTCMonth(),
              now.getUTCDate(),
              now.getUTCHours(),
              now.getUTCMinutes(),
              now.getUTCSeconds(),
              now.getUTCMilliseconds()
            )
          )
        : currentData.updated_status_at ?? null;

      console.log('*** hasChanged', hasChanged);

      if (hasChanged) {
        const logValuesBeforeUpdate = [
          receipt, // 1: receipt_number
          recipient_email, // 2: email
          currentData?.action_desc ?? null, // 3: action_desc
          currentData?.status_en ?? null, // 4: status_en
          currentData?.status_vi ?? null, // 5: status_vi
          currentData?.notice_date ?? null, // 6: notice_date
          currentData?.response_json ?? null, // 7: response_json
          currentData?.has_receipt ?? null, // 8: has_receipt
          currentData?.retries ?? null, // 9: retries
          currentData?.form_info ?? null, // 10: form_info
        ].map((v) => (v === undefined ? null : v));

        await pool.query(
          `INSERT INTO status_log (
        updated_at_log,
        receipt_number,
        email,
        updated_at_status,
        action_desc,
        status_en,
        status_vi,
        notice_date,
        response_json,
        has_receipt,
        retries,
        form_info,
        is_log_email
      )
   VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            logValuesBeforeUpdate[0], // receipt_number
            logValuesBeforeUpdate[1], // email
            currentData?.updated_at ?? null, // updated_at_status ← thêm giá trị cũ tại đây
            ...logValuesBeforeUpdate.slice(2), // còn lại đúng thứ tự
          ]
        );
      }

      console.log('*** DEBUG UPDATE PARAM', {
        action_desc: statusInfo.action_desc,
        status_en: statusInfo.status_en,
        status_vi,
        updatedStatusAt,
        raw_response: statusInfo.raw_response,
        receipt,
      });

      const conn2 = await pool.getConnection();
      const [result] = await conn2.execute(
        `UPDATE uscis 
           SET action_desc = ?, status_en = ?, status_vi = ?, updated_at = NOW(), updated_status_at = ?, response_json = ?
           WHERE receipt_number = ?`,
        [
          statusInfo.action_desc,
          statusInfo.status_en,
          status_vi,
          updatedStatusAt,
          statusInfo.raw_response,
          receipt,
        ]
      );
      conn2.release();
      console.log('✔ Rows affected:', result.affectedRows);

      await sendStatusUpdateMail({
        to: process.env.MAIL_NOTIFY,
        receipt,
        content: statusInfo.action_desc,
        email: recipient_email,
        formInfo: statusInfo.form_info,
        bodyDate,
        status_en: statusInfo.status_en,
        status_vi,
      });

      console.log(
        `✅ USCIS status updated for ${receipt} → ${statusInfo.status_en} / ${status_vi}`
      );

      await sleep(2500);
    }
  } catch (err) {
    console.error('❌ Error inserting email:', err);
  }
}

module.exports = insertEmailToDB;
