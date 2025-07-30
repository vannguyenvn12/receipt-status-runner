const db = require('./db/db');
const { callUscisApi, extractNoticeDate } = require('./api/uscisApi');

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

    for (const row of rows) {
      let retry = 0;
      const maxRetries = 3;

      while (retry < maxRetries) {
        console.log(`🔍 Kiểm tra: ${row.receipt_number} (lần ${retry + 1})`);

        const result = await callUscisApi(row.receipt_number);

        if (result.wait) {
          console.log(
            `⏸ Server yêu cầu đợi... nghỉ 1 phút (${row.receipt_number})`
          );
          await sleep(60000);
          retry++;
          continue;
        }

        if (result.error || !result.status_en) {
          console.warn(
            `⚠️ API lỗi hoặc không hợp lệ: ${result.message || 'unknown'}`
          );
          break; // bỏ qua row này
        }

        const newStatusEn = result.status_en;
        const newActionDesc = result.action_desc;

        // 2. Nếu không thay đổi trạng thái → chỉ cập nhật thời gian
        if (newStatusEn === row.status_en) {
          await db.query(
            `UPDATE uscis SET updated_at = NOW() WHERE receipt_number = ?`,
            [row.receipt_number]
          );
          console.log(`↪️ Không thay đổi trạng thái: ${row.receipt_number}`);
          break;
        }

        // 3. Trạng thái thay đổi → tra status_vi
        const [[map]] = await db.query(
          `SELECT vietnamese_status FROM setting_uscis_phase_group WHERE english_status = ?`,
          [newStatusEn]
        );
        const newStatusVi = map?.vietnamese_status || null;

        // 4. Ghi lại log cũ
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

        // 5. Cập nhật dòng chính
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
            result.notice_date,
            result.form_info,
            JSON.stringify(result.raw),
            row.receipt_number,
          ]
        );

        console.log(
          `✅ Cập nhật trạng thái mới: ${row.receipt_number} → ${newStatusEn}`
        );
        break; // xong row này → thoát khỏi while
      } // end while
    } // end for
  } catch (err) {
    console.error('❌ Lỗi hệ thống:', err.message);
  }
}

checkUSCISUpdates();
