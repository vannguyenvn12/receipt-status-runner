const xlsx = require('xlsx');
const axios = require('axios');
const dayjs = require('dayjs');
const db = require('./db/db');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractNoticeDate(text) {
  const match = text.match(/on (\w+ \d{1,2}, \d{4})/i);
  if (match) {
    return dayjs(match[1]).format('YYYY-MM-DD');
  }
  return null;
}

async function main() {
  const workbook = xlsx.readFile('./data/blank_receipe_number.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  const [mappingRows] = await db.query(
    `SELECT english_status, vietnamese_status FROM setting_uscis_phase_group`
  );

  const statusMap = {};
  mappingRows.forEach((row) => {
    statusMap[row.english_status] = row.vietnamese_status;
  });

  for (let i = 0; i < data.length; i++) {
    const receiptNumber = data[i]['Receipt Number'];
    const emailSheet = data[i]['Email'];

    const result = await callUscisApi(receiptNumber);

    if (result.wait) {
      console.log(
        `⏸ Server báo "đợi chút", tạm dừng 1 phút... (${receiptNumber})`
      );
      await sleep(60 * 1000);
      i--;
      continue;
    }

    if (result.invalid || result.error) {
      console.error(`❌ Lỗi khi xử lý ${receiptNumber}`);
      continue;
    }

    const status_vi = statusMap[result.status_en] || null;

    const row = {
      receipt_number: result.receipt_number,
      email: emailSheet,
      updated_at: new Date(),
      action_desc: result.action_desc,
      status_en: result.status_en,
      status_vi: status_vi,
      notice_date: result.notice_date,
      form_info: result.form_info,
      response_json: JSON.stringify(result.raw),
      retries: 0,
      has_receipt: true,
      status_update: false,
    };

    const values = [
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
      row.status_update,
    ];

    await db.query(
      `INSERT INTO uscis (
      receipt_number, email, updated_at, action_desc, status_en,
      status_vi, notice_date, form_info, response_json, retries, has_receipt, status_update
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values
    );

    console.log(`✅ Đã lưu: ${receiptNumber}`);
  }

  process.exit();
}

main();
