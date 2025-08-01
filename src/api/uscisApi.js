const axios = require('axios');

// Trích ngày notice
function extractNoticeDate(text) {
  const match = text.match(/(?:on|as of) (\w+ \d{1,2}, \d{4})/i);
  if (!match) return null;

  const [_, dateStr] = match;

  try {
    const dateObj = new Date(Date.parse(dateStr)); // hoặc: new Date(dateStr)
    if (isNaN(dateObj)) return null;

    // Tách ngày thủ công để bỏ ảnh hưởng timezone
    const [monthName, day, year] = dateStr.split(/[\s,]+/);
    const months = {
      January: 0,
      February: 1,
      March: 2,
      April: 3,
      May: 4,
      June: 5,
      July: 6,
      August: 7,
      September: 8,
      October: 9,
      November: 10,
      December: 11,
    };

    const utcDate = new Date(
      Date.UTC(parseInt(year), months[monthName], parseInt(day))
    );

    return utcDate.toISOString().split('T')[0]; // YYYY-MM-DD
  } catch {
    return null;
  }
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
