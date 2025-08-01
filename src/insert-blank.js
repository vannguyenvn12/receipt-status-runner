const xlsx = require('xlsx');
const db = require('./db/db');
const { callUscisApi } = require('./api/uscisApi');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // 1. Đọc file Excel
  const workbook = xlsx.readFile('./data/blank_receipe_number.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = xlsx.utils.sheet_to_json(sheet);

  // 2. Lấy mapping EN → VI
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

  // 3. Duyệt từng dòng trong file Excel
  for (let index = 0; index < rawData.length; index++) {
    const excelRow = rawData[index];

    const receiptNumber = excelRow['Receipt Number']
      ?.toString()
      .trim()
      .toUpperCase();
    const email = excelRow['Email']?.toString().trim();

    // 3.1 Chỉ xử lý nếu KHÔNG có email
    if (!receiptNumber || email) {
      console.warn(`⚠️ Dòng ${index + 2} có email hoặc thiếu mã, bỏ qua`);
      continue;
    }

    // 3.2 Kiểm tra tồn tại trong DB
    const [existing] = await db.query(
      `SELECT 1 FROM uscis WHERE receipt_number = ? LIMIT 1`,
      [receiptNumber]
    );

    if (existing.length > 0) {
      console.log(`⚠️ Receipt Number ${receiptNumber} đã tồn tại. DB đã chặn.`);
      continue;
    }

    // 3.3 Gọi API (có retry nếu bị yêu cầu wait)
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
      console.error(`❌ Bỏ qua ${receiptNumber} sau ${retries} lần thử`);
      continue;
    }

    const statusVi = statusMap[result.status_en] || null;

    const insertValues = [
      receiptNumber,
      null, // email = NULL
      new Date(),
      result.action_desc,
      result.status_en,
      statusVi,
      result.notice_date,
      result.form_info,
      JSON.stringify(result.raw),
      retries,
      false, // has_receipt = false vì chưa rõ ai nhận
      false, // status_update = false mặc định
    ];

    try {
      await db.query(
        `INSERT INTO uscis (
          receipt_number, email, updated_at, action_desc, status_en,
          status_vi, notice_date, form_info, response_json, retries, has_receipt, status_update
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        insertValues
      );

      console.log(`✅ Đã lưu mã không có email: ${receiptNumber}`);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        console.warn(`⚠️ Trùng key khi insert ${receiptNumber}, DB đã chặn`);
      } else {
        console.error(
          `💥 Lỗi không mong muốn khi insert ${receiptNumber}:`,
          err.message
        );
      }
    }

    // 3.4 Delay nhẹ tránh spam
    await sleep(1500);
  }

  console.log('🎉 Đã hoàn tất insert các mã KHÔNG có email!');
  process.exit(0);
}

main();
