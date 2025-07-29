const db = require('./db/db');
const axios = require('axios');

// Helper: Trích ngày từ action_desc
function extractNoticeDate(text) {
  const match = text.match(/on (\w+ \d{1,2}, \d{4})/i);
  if (match) {
    const d = new Date(match[1]);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
  }
  return null;
}

// Helper: Đợi X ms
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function checkUSCISUpdates() {
  try {
    // 1. Truy vấn các hồ sơ đến hạn kiểm tra
    const [rows] = await db.query(`
      SELECT u.*
      FROM uscis u
      JOIN setting_uscis_phase_group s ON u.status_en = s.english_status
      WHERE s.update_hour > 0
        AND TIMESTAMPDIFF(MINUTE, u.updated_at, NOW()) >= s.update_hour * 60
    `);

    for (let row of rows) {
      console.log(`🔍 Kiểm tra: ${row.receipt_number}`);

      // 2. Gọi API
      const response = await axios.post(
        process.env.BACKEND_URL,
        { receiptNumber: row.receipt_number },
        {
          headers: {
            'v-api-key': process.env.API_KEY,
          },
        }
      );

      if (response.data === 'doi_chut') {
        console.log('⏸ Server yêu cầu đợi... nghỉ 1 phút');
        await sleep(60000);
        continue;
      }

      const lines = response.data.trim().split('\n');
      if (!lines[1] || !lines[1].startsWith('1:')) continue;
      const parsed = JSON.parse(lines[1].slice(2));
      const caseData = parsed.data.CaseStatusResponse;

      const newStatusEn = caseData.detailsEng.actionCodeText;
      const newActionDesc = caseData.detailsEng.actionCodeDesc;

      // 3. Nếu trạng thái không thay đổi → cập nhật updated_at thôi
      console.log({
        newStatusEn,
        oldStatus: row.status_en,
      });

      if (newStatusEn === row.status_en) {
        await db.query(
          `UPDATE uscis SET updated_at = NOW() WHERE receipt_number = ?`,
          [row.receipt_number]
        );
        continue;
      }

      // 4. Trạng thái thay đổi → lấy status_vi mới
      const [[map]] = await db.query(
        `SELECT vietnamese_status FROM setting_uscis_phase_group WHERE english_status = ?`,
        [newStatusEn]
      );
      const newStatusVi = map?.vietnamese_status || null;

      // 5. Ghi lại trạng thái cũ vào status_log
      await db.query(
        `INSERT INTO status_log (
          receipt_number, email, updated_at_log, updated_at_status,
          action_desc, status_en, status_vi, notice_date,
          form_info, response_json, retries, has_receipt
        ) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.receipt_number,
          row.email,
          row.updated_at,
          row.action_desc,
          row.status_en,
          row.status_vi,
          row.notice_date,
          row.form_info,
          row.response_json,
          row.retries,
          row.has_receipt,
        ]
      );

      // 6. Cập nhật bản ghi chính
      await db.query(
        `UPDATE uscis SET
          status_en = ?, status_vi = ?, action_desc = ?,
          updated_at = NOW(), notice_date = ?, form_info = ?,
          response_json = ?, retries = 0, status_update = TRUE
         WHERE receipt_number = ?`,
        [
          newStatusEn,
          newStatusVi,
          newActionDesc,
          extractNoticeDate(newActionDesc),
          `${caseData.detailsEng.formNum} - ${caseData.detailsEng.formTitle}`,
          JSON.stringify(parsed),
          row.receipt_number,
        ]
      );

      console.log(
        `✅ Trạng thái cập nhật: ${row.receipt_number} → ${newStatusEn}`
      );
    }
  } catch (err) {
    console.error('❌ Lỗi hệ thống:', err.message);
  }
}

checkUSCISUpdates();
