const xlsx = require('xlsx');
const db = require('./db/db');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
const { callUscisApi } = require('./api/uscisApi');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function updateOneReceiptManually(receiptNumber) {
  receiptNumber = receiptNumber?.toString().trim().toUpperCase();
  if (!receiptNumber) {
    console.error('❌ Receipt number không hợp lệ!');
    return;
  }

  // 1. Kiểm tra receiptNumber có tồn tại trong DB không
  const [existing] = await db.query(
    `SELECT * FROM uscis WHERE receipt_number = ? LIMIT 1`,
    [receiptNumber]
  );

  if (existing.length === 0) {
    console.warn(`⚠️ Receipt Number ${receiptNumber} chưa có trong DB!`);
    return;
  }

  const email = existing[0].email;

  // 2. Lấy mapping trạng thái EN → VI
  const [mappingRows] = await db.query(`
    SELECT english_status, vietnamese_status 
    FROM setting_uscis_phase_group
  `);

  const statusMap = Object.fromEntries(
    mappingRows.map(({ english_status, vietnamese_status }) => [
      english_status,
      vietnamese_status,
    ])
  );

  // 3. Gọi API
  let result,
    retries = 0;

  while (retries < 3) {
    result = await callUscisApi(receiptNumber);

    if (result?.wait) {
      console.log(`⏸ API yêu cầu đợi (${receiptNumber}), nghỉ 60s...`);
      await sleep(60_000);
      retries++;
    } else {
      break;
    }
  }

  if (!result || result.error || result.invalid || result.wait) {
    console.error(`❌ Không thể cập nhật ${receiptNumber} sau ${retries} lần`);
    return;
  }

  const statusVi = statusMap[result.status_en] || null;

  const updateValues = [
    dayjs().utc().format('YYYY-MM-DD HH:mm:ss'),
    result.action_desc,
    result.status_en,
    statusVi,
    result.notice_date,
    result.form_info,
    JSON.stringify(result.raw),
    retries,
    receiptNumber,
  ];

  try {
    await db.query(
      `UPDATE uscis SET 
        updated_at = ?, 
        action_desc = ?, 
        status_en = ?, 
        status_vi = ?, 
        notice_date = ?, 
        form_info = ?, 
        response_json = ?, 
        retries = ? 
      WHERE receipt_number = ?`,
      updateValues
    );

    console.log(`✅ Đã cập nhật thủ công: ${receiptNumber}`);
  } catch (err) {
    console.error(`💥 Lỗi khi cập nhật ${receiptNumber}:`, err.message);
  }
}

updateOneReceiptManually('IOE9819867738');
