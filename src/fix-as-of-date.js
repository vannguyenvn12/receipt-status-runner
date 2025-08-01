const db = require('./db/db');
const { callUscisApi } = require('./api/uscisApi');
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function updateNullNoticeDate() {
  try {
    // 1. Lấy các dòng cần cập nhật
    const [rows] = await db.query(`
      SELECT receipt_number
      FROM uscis
      WHERE notice_date IS NULL
    `);

    console.log(`🔍 Có ${rows.length} dòng cần cập nhật.`);

    for (const row of rows) {
      const receipt = row.receipt_number;
      let retry = 0;
      let result = null;

      while (retry < 3) {
        result = await callUscisApi(receipt);

        if (result.wait) {
          console.log(`⏸ Server yêu cầu đợi... (${receipt})`);
          await sleep(60000);
          retry++;
          continue;
        }

        if (result.error || !result.notice_date) {
          console.warn(`⚠️ Không thể cập nhật: ${receipt}`);
          break;
        }

        break;
      }

      if (!result || !result.notice_date) continue;

      // Mapping tiếng Việt (nếu cần)
      const [[map]] = await db.query(
        `SELECT vietnamese_status FROM setting_uscis_phase_group WHERE english_status = ?`,
        [result.status_en]
      );
      const status_vi = map?.vietnamese_status || null;

      // 2. Thực hiện UPDATE
      await db.query(
        `UPDATE uscis
         SET action_desc = ?,
             status_en = ?,
             status_vi = ?,
             notice_date = ?,
             form_info = ?,
             response_json = ?,
             updated_at = NOW(),
             retries = 0,
             has_receipt = TRUE,
             status_update = TRUE
         WHERE receipt_number = ?`,
        [
          result.action_desc,
          result.status_en,
          status_vi,
          result.notice_date,
          result.form_info,
          JSON.stringify(result.raw),
          receipt,
        ]
      );

      console.log(`✅ Đã cập nhật ${receipt} → ${result.notice_date}`);
      await sleep(1500); // tránh spam
    }
  } catch (err) {
    console.error('❌ Lỗi khi cập nhật notice_date:', err.message);
  }
}

updateNullNoticeDate();
