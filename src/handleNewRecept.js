const db = require('./db/db');
const { callUscisApi } = require('./api/uscisApi');

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

async function fetchNewReceipts({ limit = 100, receipt = null } = {}) {
  const params = [];
  let where =
    `COALESCE(action_desc,'')='' AND ` +
    `COALESCE(status_en,'')='' AND ` +
    `COALESCE(form_info,'')='' AND ` +
    `COALESCE(response_json,'')=''`;

  if (receipt) {
    where += ` AND receipt_number = ?`;
    params.push(receipt);
  }

  params.push(Number(limit));

  const [rows] = await db.query(
    `
    SELECT id, receipt_number, email
    FROM uscis
    WHERE ${where}
    ORDER BY id DESC
    LIMIT ?
  `,
    params
  );

  return rows;
}

async function updateRowFromApi({ id, receipt_number, email }, statusMap) {
  let result;
  let retries = 0;

  while (retries < 3) {
    result = await callUscisApi(receipt_number);

    if (result?.wait) {
      console.log(`⏸ API yêu cầu đợi (${receipt_number}), nghỉ 60s...`);
      await sleep(60_000);
      retries++;
    } else {
      break;
    }
  }

  if (!result || result.error || result.invalid || result.wait) {
    console.error(`❌ Bỏ qua ${receipt_number} sau ${retries} lần thử`);
    return;
  }

  const statusVi = statusMap[result.status_en] || null;

  const values = [
    new Date(),
    result.action_desc || null,
    result.status_en || null,
    statusVi,
    result.notice_date || null,
    result.form_info || null,
    JSON.stringify(result.raw || {}),
    retries,
    true,
    false,
    id,
  ];

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
      retries = ?,
      has_receipt = ?,
      status_update = ?
    WHERE id = ?
    `,
    values
  );

  console.log(`✅ Đã cập nhật: ${receipt_number}`);
}

async function main(options = {}) {
  const limit = options.limit || 100;
  const receipt = options.receipt || null;

  const statusMap = await getStatusMap();
  const rows = await fetchNewReceipts({ limit, receipt });

  if (!rows.length) {
    console.log('🟡 Không có hồ sơ mới cần cập nhật.');
    return;
  }

  console.log(`🔎 Tìm thấy ${rows.length} hồ sơ mới. Bắt đầu cập nhật...`);

  for (const row of rows) {
    try {
      await updateRowFromApi(row, statusMap);
    } catch (err) {
      console.error(`💥 Lỗi khi cập nhật ${row.receipt_number}:`, err.message);
    }
    await sleep(1500);
  }

  console.log('🎉 Hoàn tất cập nhật các hồ sơ mới!');
}

// Cho phép gọi trực tiếp từ CLI
if (require.main === module) {
  const argv = process.argv.slice(2);
  const limitArg =
    argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ||
    argv[argv.indexOf('--limit') + 1];
  const receiptArg =
    argv.find((a) => a.startsWith('--receipt='))?.split('=')[1] ||
    argv[argv.indexOf('--receipt') + 1];

  main({
    limit: Number(limitArg) > 0 ? Number(limitArg) : 100,
    receipt: receiptArg ? String(receiptArg).trim().toUpperCase() : null,
  }).then(() => process.exit(0));
}

module.exports = {
  handleNewReceipt: main,
};
