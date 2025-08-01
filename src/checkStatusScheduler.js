const db = require('./db/db');
const { callUscisApi } = require('./api/uscisApi');

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function checkUSCISUpdates() {
  try {
    const [rows] = await db.query(`
      SELECT u.*
      FROM uscis u
      JOIN setting_uscis_phase_group s ON u.status_en = s.english_status
      WHERE s.update_hour > 0
        AND TIMESTAMPDIFF(MINUTE, u.updated_at, NOW()) >= s.update_hour * 60
    `);

    if (!rows.length) {
      console.log('✅ Không có hồ sơ nào cần cập nhật.');
      return;
    }

    for (const row of rows) {
      try {
        let retry = 0;
        const maxRetries = 3;
        let result = null;

        while (retry < maxRetries) {
          console.log(`🔍 Kiểm tra: ${row.receipt_number} (lần ${retry + 1})`);

          result = await callUscisApi(row.receipt_number);

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
            break;
          }

          break; // Thoát retry nếu gọi OK
        }

        if (!result || result.wait || result.error || !result.status_en) {
          console.warn(`⚠️ Bỏ qua ${row.receipt_number} sau ${retry} lần`);
          continue;
        }

        const newStatusEn = result.status_en;
        const newActionDesc = result.action_desc;

        // Nếu không thay đổi trạng thái
        if (newStatusEn === row.status_en) {
          await db.query(
            `UPDATE uscis SET updated_at = NOW() WHERE receipt_number = ?`,
            [row.receipt_number]
          );
          console.log(`↪️ Không thay đổi: ${row.receipt_number}`);
          continue;
        }

        // Trạng thái thay đổi → lấy status_vi
        const [[map]] = await db.query(
          `SELECT vietnamese_status FROM setting_uscis_phase_group WHERE english_status = ?`,
          [newStatusEn]
        );
        const newStatusVi = map?.vietnamese_status || null;

        // Lưu vào log
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

        // Cập nhật dòng chính
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

        console.log(`✅ Cập nhật: ${row.receipt_number} → ${newStatusEn}`);
      } catch (err) {
        console.error(`💥 Lỗi xử lý ${row.receipt_number}:`, err.message);
      }

      // Nghỉ 2.5s để tránh overload server/API
      await sleep(2500);
    }
  } catch (err) {
    console.error('❌ Lỗi hệ thống:', err.message);
  }
}

checkUSCISUpdates();
