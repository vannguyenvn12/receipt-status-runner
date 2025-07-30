const axios = require('axios');

// Trích ngày notice
function extractNoticeDate(text) {
  const match = text.match(/on (\w+ \d{1,2}, \d{4})/i);
  if (match) {
    const d = new Date(match[1]);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
  }
  return null;
}

// Hàm delay
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Hàm gọi API USCIS có retry nếu nội dung rỗng
async function callUscisApi(receiptNumber, maxRetries = 10, delayMs = 1000) {
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;

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

      const content = response.data?.trim();

      // Nếu server yêu cầu đợi chút
      if (content === 'doi_chut') {
        return { wait: true };
      }

      // Nếu không có nội dung
      if (!content) {
        console.warn(
          `⚠️ Dữ liệu rỗng, thử lại lần ${attempts}/${maxRetries}...`
        );
        await sleep(delayMs);
        continue;
      }

      const lines = content.split('\n');
      if (!lines[1] || !lines[1].startsWith('1:')) {
        console.warn(
          `⚠️ Dữ liệu không hợp lệ, thử lại lần ${attempts}/${maxRetries}...`
        );
        await sleep(delayMs);
        continue;
      }

      const parsed = JSON.parse(lines[1].slice(2));
      const caseData = parsed.data.CaseStatusResponse;

      const status_en = caseData.detailsEng.actionCodeText;
      const action_desc = caseData.detailsEng.actionCodeDesc;
      const form_info = `${caseData.detailsEng.formNum} - ${caseData.detailsEng.formTitle}`;
      const notice_date = extractNoticeDate(action_desc);

      return {
        receipt_number: caseData.receiptNumber,
        action_desc,
        status_en,
        form_info,
        notice_date,
        raw: parsed,
      };
    } catch (err) {
      console.error(
        `❌ Lỗi API ở lần ${attempts}/${maxRetries}: ${err.message}`
      );
      await sleep(delayMs);
    }
  }

  return {
    error: true,
    message: `Gọi API thất bại sau ${maxRetries} lần.`,
  };
}

module.exports = {
  callUscisApi,
  extractNoticeDate,
};
