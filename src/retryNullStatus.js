const db = require("./db/db");
const { callUscisApi } = require("./api/uscisApi");

const INVALID_MSG = "The receipt number entered is invalid, please try again.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getStatusMap() {
  const [rows] = await db.query(`
    SELECT english_status, vietnamese_status 
    FROM setting_uscis_phase_group
  `);
  return Object.fromEntries(
    rows.map(({ english_status, vietnamese_status }) => [
      english_status,
      vietnamese_status,
    ])
  );
}

async function fetchNullStatusReceipts() {
  const [rows] = await db.query(
    `
    SELECT id, receipt_number, email
    FROM uscis
    WHERE status_en IS NULL
    ORDER BY updated_at ASC
    `
  );

  return rows;
}

async function updateRowFromApi({ id, receipt_number, email }, statusMap) {
  const result = await callUscisApi(receipt_number);

  // Nếu vẫn invalid/error/wait → cập nhật 'error'
  if (!result || result.error || result.invalid || result.wait) {
    console.warn(`❌ ${receipt_number} vẫn invalid/wait → giữ 'error'`);

    const failPayload = {
      reason: "retry_null_failed_or_wait",
      last_result: result ?? null,
    };

    await db.query(
      `
      UPDATE uscis
      SET
        updated_at = ?,
        action_desc = NULL,
        status_en = ?,
        status_vi = NULL,
        notice_date = NULL,
        form_info = 'error',
        response_json = ?,
        has_receipt = 1,
        status_update = 0
      WHERE id = ?
      `,
      [new Date(), INVALID_MSG, JSON.stringify(failPayload), id]
    );

    return false;
  }

  // Nếu thành công → cập nhật đầy đủ
  const statusVi = statusMap[result.status_en] || null;

  await db.query(
    `
    UPDATE uscis
    SET
      updated_at = ?,
      action_desc = ?,
      status_en = ?,
      status_vi = ?,
      notice_date = ?,
      form_info = ?,
      response_json = ?,
      has_receipt = 1,
      status_update = 0
    WHERE id = ?
    `,
    [
      new Date(),
      result.action_desc || null,
      result.status_en || null,
      statusVi,
      result.notice_date || null,
      result.form_info || null,
      JSON.stringify(result.raw || {}),
      id,
    ]
  );

  console.log(`✅ Đã cập nhật lại: ${receipt_number}`);
  return true;
}

async function main() {
  const statusMap = await getStatusMap();
  const rows = await fetchNullStatusReceipts();

  if (!rows.length) {
    console.log("🟡 Không có hồ sơ NULL status cần cập nhật lại.");
    return;
  }

  console.log(`🔁 Tìm thấy ${rows.length} hồ sơ NULL status. Bắt đầu retry...`);

  let ok = 0,
    stillInvalid = 0,
    failed = 0;

  for (const row of rows) {
    try {
      const success = await updateRowFromApi(row, statusMap);
      if (success) ok++;
      else stillInvalid++;
    } catch (err) {
      failed++;
      console.error(`💥 Lỗi khi cập nhật ${row.receipt_number}:`, err.message);
    }
    await sleep(1500);
  }

  console.log(
    `🏁 Hoàn tất retry. Thành công: ${ok} | Vẫn invalid/wait: ${stillInvalid} | Lỗi khác: ${failed}`
  );
}

// Cho phép chạy trực tiếp
if (require.main === module) {
  main().then(() => process.exit(0));
}

module.exports = {
  handleRetryNullStatus: main,
};
