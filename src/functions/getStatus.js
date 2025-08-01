const { callUscisApi } = require('../api/uscisApi');

async function getStatus(receiptNumber) {
  const result = await callUscisApi(receiptNumber);
  if (result.wait || result.invalid || result.error) return result;

  console.log('*** [2. getStatus.js]: ', result.action_desc);
  console.log('--------------------------------');

  return {
    status_en: result.status_en,
    action_desc: result.action_desc,
    notice_date: result.notice_date,
    form_info: result.form_info,
    raw_response: result.raw,
  };
}

module.exports = getStatus;
