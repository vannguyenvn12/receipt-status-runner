const pool = require('./db/db');

async function backfillUpdatedStatusAt() {
  try {
    const [rows] = await pool.query(`
      SELECT receipt_number, status_en, action_desc, updated_at
      FROM uscis
      WHERE updated_status_at IS NULL
    `);

    if (!rows.length) {
      console.log('✅ Không có hồ sơ nào cần cập nhật updated_status_at.');
      return;
    }

    for (const row of rows) {
      const { receipt_number, status_en, action_desc, updated_at } = row;

      // Lấy log gần nhất (is_log_email = 0)
      const [[log]] = await pool.query(
        `
        SELECT updated_at_log, status_en, action_desc
        FROM status_log
        WHERE receipt_number = ?
          AND is_log_email = 0
        ORDER BY updated_at_log DESC
        LIMIT 1
        `,
        [receipt_number]
      );

      if (!log) {
        console.warn(
          `⚠️ Không có log cho ${receipt_number} → BỎ QUA (không cập nhật).`
        );
        continue;
      }

      const hasChanged =
        log.status_en !== status_en || log.action_desc !== action_desc;

      if (!hasChanged) {
        console.log(
          `⏩ Trạng thái không thay đổi cho ${receipt_number} → BỎ QUA`
        );
        continue;
      }

      // Nếu có thay đổi → cập nhật updated_status_at = updated_at
      await pool.query(
        `
        UPDATE uscis
        SET updated_status_at = ?
        WHERE receipt_number = ?
        `,
        [updated_at, receipt_number]
      );

      console.log(
        `✅ Đã cập nhật updated_status_at cho ${receipt_number} → ${updated_at}`
      );
    }

    console.log('🎉 Hoàn tất cập nhật updated_status_at.');
  } catch (err) {
    console.error('❌ Lỗi khi cập nhật updated_status_at:', err.message);
  }
}

backfillUpdatedStatusAt();
