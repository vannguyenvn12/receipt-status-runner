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

      // Tìm bản ghi cuối cùng trong status_log có khác status_en hoặc action_desc
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

      let updatedStatusAt = null;

      if (!log) {
        // Không có log cũ → dùng updated_at hiện tại
        updatedStatusAt = updated_at;
        console.warn(
          `⚠️ Không tìm thấy log cho ${receipt_number}, dùng updated_at hiện tại.`
        );
      } else if (
        log.status_en !== status_en ||
        log.action_desc !== action_desc
      ) {
        // Có log nhưng status đã khác → dùng updated_at hiện tại
        updatedStatusAt = updated_at;
        console.log(
          `🔁 Đã thay đổi trạng thái cho ${receipt_number}, cập nhật updated_status_at.`
        );
      } else {
        // Không đổi trạng thái → gán updated_status_at bằng log
        updatedStatusAt = log.updated_at_log;
        console.log(
          `↩️ Giữ nguyên trạng thái ${receipt_number}, updated_status_at = log.`
        );
      }

      const [result] = await pool.query(
        `
        UPDATE uscis
        SET updated_status_at = ?
        WHERE receipt_number = ?
      `,
        [updatedStatusAt, receipt_number]
      );

      console.log(
        `✅ Cập nhật ${receipt_number} → updated_status_at = ${updatedStatusAt}`
      );
    }

    console.log('🎉 Hoàn tất cập nhật updated_status_at.');
  } catch (err) {
    console.error('❌ Lỗi khi cập nhật updated_status_at:', err.message);
  }
}

backfillUpdatedStatusAt();
