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
  const receiverAddress = to?.value?.[0]?.address || null;
  const forwarded_date = new Date(date);

  const { sent_time_raw } = extractForwardedData(email_body);
  const { sender_email, recipient_email } =
    extractForwardedDataAndRecipient(email_body);
  const bodyDate = extractSentDate(email_body);
  const sqlDate = convertVietnameseDateToSQL(bodyDate);

  console.log('*** CHECK EMAIL', { receiverAddress, sender_email });

  let emailRowId = null;

  // ✅ Check đã tồn tại email tương tự chưa (dù chưa có messageId)
  const [[existingRow]] = await pool.query(
    `SELECT id, is_no_receipt_notified FROM email_uscis 
     WHERE subject = ? AND recipient_email = ? AND DATE(forwarded_date) = DATE(?) 
     ORDER BY id DESC LIMIT 1`,
    [subject, recipient_email, forwarded_date]
  );

  if (existingRow) {
    console.log(`📨 Email đã tồn tại trước đó với ID: ${existingRow.id}`);
    emailRowId = existingRow.id;
  } else {
    // ✅ Insert email mới
    const [insertResult] = await pool.query(
      `INSERT INTO email_uscis 
       (message_id, forwarded_date, sender, receiver, subject, email_body, sender_email, sent_time_raw, recipient_email, is_no_receipt_notified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        null,
        forwarded_date,
        sender,
        receiverAddress,
        subject,
        email_body,
        sender_email,
        sent_time_raw,
        recipient_email,
      ]
    );
    emailRowId = insertResult.insertId;
    console.log(`✅ Inserted email ID: ${emailRowId}`);
  }

  // 🔍 Lấy danh sách receipt liên kết với email
  const receipts = await getReceiptByEmail(recipient_email);
  console.log('📬 Receipts:', receipts);

  if (!receipts || receipts.length === 0) {
    const [[emailRow]] = await pool.query(
      `SELECT is_no_receipt_notified FROM email_uscis WHERE id = ?`,
      [emailRowId]
    );

    if (emailRow?.is_no_receipt_notified !== 1) {
      await sendNoEmailStatus({
        to: process.env.MAIL_NOTIFY,
        email: recipient_email,
      });

      await pool.query(
        `UPDATE email_uscis SET is_no_receipt_notified = 1 WHERE id = ?`,
        [emailRowId]
      );
      console.log(`📨 Gửi cảnh báo không có receipt cho ${recipient_email}`);
    } else {
      console.log('⏭ Đã gửi cảnh báo trước đó, bỏ qua.');
    }

    return;
  }

  // 🚀 Tiến hành xử lý từng receipt
  for (const receipt of receipts) {
    console.log(`📦 Đang xử lý receipt: ${receipt}`);
    let statusInfo;
    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      statusInfo = await getStatus(receipt);
      if (!statusInfo.wait) break;

      console.log(`⏸ Retry ${retries + 1}/5... nghỉ 1 phút`);
      await sleep(60000);
      retries++;
    }

    if (statusInfo.wait || statusInfo.error || !statusInfo.status_en) {
      console.warn(`⚠️ Không thể lấy trạng thái hợp lệ cho ${receipt}`);
      continue;
    }

    const [[map]] = await pool.query(
      `SELECT vietnamese_status FROM setting_uscis_phase_group WHERE english_status = ?`,
      [statusInfo.status_en]
    );
    const status_vi = map?.vietnamese_status || null;

    const [[currentData]] = await pool.query(
      `SELECT action_desc, status_en, status_vi, notice_date, response_json, has_receipt, retries, form_info, updated_at, updated_status_at
       FROM uscis WHERE receipt_number = ?`,
      [receipt]
    );

    const hasChanged =
      statusInfo.status_en !== currentData.status_en ||
      statusInfo.action_desc !== currentData.action_desc;

    const updatedStatusAt = hasChanged
      ? dayjs().utc().format('YYYY-MM-DD HH:mm:ss')
      : currentData.updated_status_at ?? null;

    if (hasChanged) {
      await pool.query(
        `INSERT INTO status_log (
           updated_at_log, receipt_number, email, updated_at_status,
           action_desc, status_en, status_vi, notice_date,
           response_json, has_receipt, retries, form_info, is_log_email
         ) VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          receipt,
          recipient_email,
          currentData.updated_at,
          currentData.action_desc,
          currentData.status_en,
          currentData.status_vi,
          currentData.notice_date,
          currentData.response_json,
          currentData.has_receipt,
          currentData.retries,
          currentData.form_info,
        ]
      );
    }

    await pool.query(
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

    console.log(`✅ Cập nhật trạng thái ${receipt}: ${status_vi}`);
    await sleep(2500);
  }

  // ✅ Cập nhật message_id cuối cùng
  if (messageId) {
    await pool.query(
      `UPDATE email_uscis SET message_id = ? WHERE id = ? AND message_id IS NULL`,
      [messageId, emailRowId]
    );
  }
}
