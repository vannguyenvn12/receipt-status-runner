// src/mail/getStatus.js
const axios = require('axios');

// Helper: Trích ngày notice từ mô tả
function extractNoticeDate(text) {
  const match = text.match(/on (\w+ \d{1,2}, \d{4})/i);
  if (match) {
    const d = new Date(match[1]);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
  }
  return null;
}

// Gọi API và trả về status
async function getStatus(receiptNumber) {
  try {
    const response = await axios.post(
      process.env.BACKEND_URL,
      { receiptNumber },
      {
        headers: {
          'v-api-key': process.env.API_KEY,
        },
      }
    );

    if (response.data === 'doi_chut') {
      return { wait: true };
    }

    const lines = response.data.trim().split('\n');
    if (!lines[1] || !lines[1].startsWith('1:')) {
      console.warn('⚠️ Dữ liệu không hợp lệ');
      return null;
    }

    const parsed = JSON.parse(lines[1].slice(2));
    const caseData = parsed.data.CaseStatusResponse;

    const status_en = caseData.detailsEng.actionCodeText;
    const action_desc = caseData.detailsEng.actionCodeDesc;
    const form_info = `${caseData.detailsEng.formNum} - ${caseData.detailsEng.formTitle}`;
    const notice_date = extractNoticeDate(action_desc);

    return {
      status_en,
      action_desc,
      notice_date,
      form_info,
      raw_response: parsed,
    };
  } catch (err) {
    console.error(`❌ Lỗi khi gọi API USCIS: ${err.message}`);
    return null;
  }
}

module.exports = getStatus;
