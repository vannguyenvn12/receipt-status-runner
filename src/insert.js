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
    try {
      const res = await axios.post(
        'https://02cf6b6d4ffc.ngrok-free.app/send-data',
        {
          receiptNumber,
        },
        {
          headers: {
            'v-api-key': process.env.API_KEY,
          },
        }
      );

      // Nếu server yêu cầu "đợi chút", thì tạm dừng 1 phút và tiếp tục
      if (res.data === 'doi_chut') {
        console.log(
          `⏸ Server báo "đợi chút", tạm dừng 1 phút... (${receiptNumber})`
        );
        await sleep(60 * 1000); // 1 phút
        i--; // xử lý lại cùng receiptNumber ở lần sau
        continue;
      }

      const lines = res.data.trim().split('\n');
      if (!lines[1] || !lines[1].startsWith('1:')) continue;

      const jsonStr = lines[1].slice(2);
      const parsed = JSON.parse(jsonStr);
      const caseData = parsed.data.CaseStatusResponse;

      //   Status việt nam
      const status_en = caseData.detailsEng.actionCodeText;
      const status_vi = statusMap[status_en] || null; // Nếu không tìm thấy thì để null

      const row = {
        receipt_number: caseData.receiptNumber,
        email: emailSheet,
        updated_at: new Date(),
        action_desc: caseData.detailsEng.actionCodeDesc,
        status_en: caseData.detailsEng.actionCodeText,
        status_vi: status_vi,
        notice_date: extractNoticeDate(caseData.detailsEng.actionCodeDesc),
        form_info: `${caseData.detailsEng.formNum} - ${caseData.detailsEng.formTitle}`,
        response_json: JSON.stringify(parsed),
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
    } catch (err) {
      console.error(`❌ Lỗi với ${receiptNumber}:`, err.message);
    }
  }

  process.exit();
}

main();
