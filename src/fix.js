const db = require('./db/db');
const { callUscisApi } = require('./api/uscisApi');
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function fixMismatchedReceipts() {
  // 1. Lấy các dòng có action_desc chứa IOE khác với receipt_number
  const [rows] = await db.query(`
    SELECT id, receipt_number, action_desc 
    FROM uscis
    WHERE action_desc REGEXP 'IOE[0-9]{10}'
      AND action_desc NOT LIKE CONCAT('%', receipt_number, '%')
  `);

  // 2. Map trạng thái sang tiếng Việt
  const [mappingRows] = await db.query(`
    SELECT english_status, vietnamese_status 
    FROM setting_uscis_phase_group
  `);
  const statusMap = {};
  mappingRows.forEach((row) => {
    statusMap[row.english_status] = row.vietnamese_status;
  });

  for (const row of rows) {
    const receipt = row.receipt_number.trim().toUpperCase();

    console.log(`🔄 Đang xử lý: ${receipt}`);

    let result;
    let retry = 0;

    while (retry < 3) {
      result = await callUscisApi(receipt);

      if (result.wait) {
        console.log(`⏸ Server yêu cầu đợi: ${receipt}`);
        await sleep(60000);
        retry++;
        continue;
      }

      break;
    }

    if (!result || result.wait || result.invalid || result.error) {
      console.warn(`❌ API lỗi với ${receipt}`);
      continue;
    }

    const status_vi = statusMap[result.status_en] || null;

    await db.query(
      `UPDATE uscis SET
        action_desc = ?,
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

    console.log(`✅ Đã cập nhật: ${receipt}`);
    await sleep(2500); // Tránh rate limit
  }

  console.log('🎉 Đã hoàn tất cập nhật các dòng mismatched.');
}

fixMismatchedReceipts();
