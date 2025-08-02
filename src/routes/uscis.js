const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { callUscisApi } = require('../api/uscisApi');
const sendNewReceipt = require('../mail/new-mailer');
const sendEmailChanged = require('../mail/change-mailer');

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

router.post('/', async (req, res) => {
  const { receiptNumber, email } = req.body;

  if (!receiptNumber) {
    return res.status(400).json({ error: 'Thiếu receiptNumber' });
  }

  const receipt = receiptNumber.trim().toUpperCase();
  const userEmail = email?.trim() || ''; // Nếu không có thì là chuỗi rỗng

  try {
    // 1. Check tồn tại
    const [existing] = await db.query(
      `SELECT 1 FROM uscis WHERE receipt_number = ? LIMIT 1`,
      [receipt]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: `Receipt ${receipt} đã tồn tại.` });
    }

    // 2. Lấy map EN-VI
    const [mappingRows] = await db.query(
      `SELECT english_status, vietnamese_status FROM setting_uscis_phase_group`
    );
    const statusMap = Object.fromEntries(
      mappingRows.map(({ english_status, vietnamese_status }) => [
        english_status,
        vietnamese_status,
      ])
    );

    // 3. Gọi API USCIS
    let result,
      retries = 0;

    while (retries < 3) {
      result = await callUscisApi(receipt);

      if (result?.wait) {
        console.log(`⏳ Đợi API cho ${receipt}, nghỉ 60s`);
        await sleep(60000);
        retries++;
      } else {
        break;
      }
    }

    if (!result || result.error || result.invalid || result.wait) {
      return res
        .status(500)
        .json({ error: `Không thể lấy kết quả từ USCIS`, result });
    }

    // 4. Chuyển EN → VI
    const statusVi = statusMap[result.status_en] || null;

    const insertValues = [
      receipt,
      userEmail || null, // tránh insert undefined
      new Date(),
      result.action_desc,
      result.status_en,
      statusVi,
      result.notice_date,
      result.form_info,
      JSON.stringify(result.raw),
      retries,
      true,
      false,
    ];

    // 5. Ghi DB
    await db.query(
      `INSERT INTO uscis (
        receipt_number, email, updated_at, action_desc, status_en,
        status_vi, notice_date, form_info, response_json, retries, has_receipt, status_update
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      insertValues
    );

    // 6. Gửi email thông báo
    await sendNewReceipt({
      to: process.env.MAIL_NOTIFY,
      receipt,
      email: userEmail,
    });

    return res.json({ success: true, receipt, status_en: result.status_en });
  } catch (error) {
    console.error(`💥 Lỗi xử lý receipt ${receipt}:`, error.message);
    return res
      .status(500)
      .json({ error: 'Lỗi server', message: error.message });
  }
});

router.put('/email', async (req, res) => {
  const { receiptNumber, oldEmail, newEmail } = req.body;

  if (!receiptNumber || !newEmail) {
    return res.status(400).json({ error: 'Thiếu receiptNumber hoặc newEmail' });
  }

  const receipt = receiptNumber.trim().toUpperCase();
  const cleanedOldEmail = oldEmail?.trim() || '(không có)';
  const cleanedNewEmail = newEmail.trim();

  try {
    // Kiểm tra receipt tồn tại
    const [rows] = await db.query(
      `SELECT email FROM uscis WHERE receipt_number = ?`,
      [receipt]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Receipt không tồn tại.' });
    }

    const currentEmail = rows[0].email || '';

    if (currentEmail === cleanedNewEmail) {
      return res.json({ message: 'Email không thay đổi.' });
    }

    // Cập nhật email
    await db.query(`UPDATE uscis SET email = ? WHERE receipt_number = ?`, [
      cleanedNewEmail,
      receipt,
    ]);

    // Gửi thông báo email thay đổi
    await sendEmailChanged({
      to: process.env.MAIL_NOTIFY,
      receipt,
      oldEmail: cleanedOldEmail,
      newEmail: cleanedNewEmail,
    });

    return res.json({
      success: true,
      message: `Đã cập nhật email cho receipt ${receipt}`,
    });
  } catch (err) {
    console.error('💥 Lỗi khi đổi email:', err.message);
    return res.status(500).json({ error: 'Lỗi server', message: err.message });
  }
});

module.exports = router;
