const axios = require('axios');

// Trích ngày notice từ mô tả
function extractNoticeDate(text) {
  const match = text.match(/(?:on|as of) (\w+ \d{1,2}, \d{4})/i);
  if (!match) return null;

  const [_, dateStr] = match;
  try {
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
    const utcDate = new Date(Date.UTC(+year, months[monthName], +day));
    return utcDate.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

// Delay
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gọi USCIS API có kiểm soát retry tách biệt
async function callUscisApi(
  receiptNumber,
  maxCommonRetries = 10,
  maxMismatchRetries = 10,
  delayMs = 1000
) {
  let commonAttempts = 0;
  let mismatchCount = 0;

  while (
    commonAttempts < maxCommonRetries &&
    mismatchCount < maxMismatchRetries
  ) {
    try {
      const response = await axios.post(
        process.env.BACKEND_URL,
        { receiptNumber },
        {
          headers: { 'v-api-key': process.env.API_KEY },
        }
      );

      const content = response.data?.trim();

      if (content === 'doi_chut') {
        return { wait: true };
      }

      // Dữ liệu rỗng
      if (!content) {
        commonAttempts++;
        console.warn(
          `⚠️ Dữ liệu rỗng. Retry ${commonAttempts}/${maxCommonRetries}`
        );
        await sleep(delayMs);
        continue;
      }

      const lines = content.split('\n');
      if (!lines[1] || !lines[1].startsWith('1:')) {
        commonAttempts++;
        console.warn(
          `⚠️ Dữ liệu không hợp lệ. Retry ${commonAttempts}/${maxCommonRetries}`
        );
        await sleep(delayMs);
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(lines[1].slice(2));
      } catch (err) {
        commonAttempts++;
        console.warn(
          `❌ JSON parse lỗi. Retry ${commonAttempts}/${maxCommonRetries}`
        );
        await sleep(delayMs);
        continue;
      }

      const caseData = parsed.data.CaseStatusResponse;
      const receiptFromResponse = caseData.receiptNumber?.trim();
      const action_desc = caseData.detailsEng.actionCodeDesc;
      const status_en = caseData.detailsEng.actionCodeText;
      const form_info = `${caseData.detailsEng.formNum} - ${caseData.detailsEng.formTitle}`;
      const notice_date = extractNoticeDate(action_desc);

      // ✅ Kiểm tra receipt trong action_desc
      const matchReceiptInText = action_desc.match(/Receipt Number (\w+)/i);
      const receiptInText = matchReceiptInText?.[1]?.trim();

      console.log('✅ Check receipt trong action_desc:', receiptInText);

      if (receiptInText && receiptInText !== receiptNumber) {
        mismatchCount++;
        console.warn(
          `🚨 Receipt KHÔNG KHỚP: API=${receiptNumber}, mô tả=${receiptInText}. Mismatch ${mismatchCount}/${maxMismatchRetries}`
        );
        await sleep(delayMs);
        continue;
      }

      console.log('*** 1.[uscisApi.js]:', action_desc);
      console.log('--------------------------------');

      return {
        receipt_number: receiptFromResponse,
        action_desc,
        status_en,
        form_info,
        notice_date,
        raw: parsed,
      };
    } catch (err) {
      commonAttempts++;
      console.error(
        `❌ Lỗi hệ thống: ${err.message}. Retry ${commonAttempts}/${maxCommonRetries}`
      );
      await sleep(delayMs);
    }
  }

  const reason =
    mismatchCount >= maxMismatchRetries
      ? 'Lỗi mismatch nhiều lần'
      : 'Lỗi hệ thống hoặc dữ liệu quá nhiều lần';

  return {
    error: true,
    message: `Gọi API thất bại (${reason})`,
  };
}

module.exports = {
  callUscisApi,
  extractNoticeDate,
};
