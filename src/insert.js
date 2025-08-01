const xlsx = require('xlsx');
const db = require('./db/db');
const { callUscisApi } = require('./api/uscisApi');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // 1. Đọc Excel
  const workbook = xlsx.readFile('./data/blank_receipe_number.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = xlsx.utils.sheet_to_json(sheet);

  // 2. Map trạng thái EN → VI
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

  // 3. Duyệt từng dòng
  for (let index = 0; index < rawData.length; index++) {
    const excelRow = rawData[index];

    const receiptNumber = excelRow['Receipt Number']
      ?.toString()
      .trim()
      .toUpperCase();
    const email = excelRow['Email']?.toString().trim();

    // 3.1 Bỏ qua nếu thiếu
    if (!receiptNumber || !email) {
      console.warn(`⚠️ Dòng ${index + 2} thiếu dữ liệu, bỏ qua`);
      continue;
    }

    // 3.2 Kiểm tra tồn tại trong DB trước
    const [existing] = await db.query(
      `SELECT 1 FROM uscis WHERE receipt_number = ? LIMIT 1`,
      [receiptNumber]
    );

    if (existing.length > 0) {
      console.log(`⚠️ Receipt Number ${receiptNumber} đã tồn tại. DB đã chặn.`);
      continue;
    }

    // 3.3 Gọi API (retry tối đa 3 lần nếu server "wait")
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

    // 3.4 Nếu lỗi API hoặc kết quả không hợp lệ
    if (!result || result.error || result.invalid || result.wait) {
      console.error(`❌ Bỏ qua ${receiptNumber} sau ${retries} lần thử`);
      continue;
    }

    const statusVi = statusMap[result.status_en] || null;

    const insertValues = [
      receiptNumber,
      email,
      new Date(),
      result.action_desc,
      result.status_en,
      statusVi,
      result.notice_date,
      result.form_info,
      JSON.stringify(result.raw),
      retries,
      true,
      false,
    ];

    try {
      await db.query(
        `INSERT INTO uscis (
          receipt_number, email, updated_at, action_desc, status_en,
          status_vi, notice_date, form_info, response_json, retries, has_receipt, status_update
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        insertValues
      );

      console.log(`✅ Đã lưu: ${receiptNumber}`);
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

    // 3.5 Nghỉ nhẹ sau mỗi lần gọi
    await sleep(1500);
  }

  console.log('🎉 Xong toàn bộ!');
  process.exit(0);
}

main();
