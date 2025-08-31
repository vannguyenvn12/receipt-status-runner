const pool = require('./db/db');
const { extractNoticeDate, callUscisApi } = require('./uscisApi'); // chỉnh path nếu khác

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kiểm tra và sửa notice_date cho 1 receipt:
 * - Nếu notice_date NULL hoặc khác với ngày trích từ action_desc
 *   → gọi API, lấy action_desc/notice_date mới, rồi UPDATE.
 */
async function fixMismatchNoticeDate(receiptNumber) {
  const [[row]] = await pool.query(
    `SELECT receipt_number, action_desc, notice_date 
     FROM uscis 
     WHERE receipt_number = ? 
     LIMIT 1`,
    [receiptNumber]
  );

  if (!row) {
    console.warn(`⚠️ Không tìm thấy receipt: ${receiptNumber}`);
    return { updated: false, reason: 'not_found' };
  }

  const currentNotice = row.notice_date || null;
  const extractedLocal = row.action_desc
    ? extractNoticeDate(row.action_desc)
    : null;

  const isMismatch =
    currentNotice === null ||
    (extractedLocal && currentNotice !== extractedLocal);

  if (!isMismatch) {
    // Đã đúng rồi, không cần gọi API
    return { updated: false, reason: 'already_correct', currentNotice };
  }

  // 🚀 Gọi API khi mismatch/null
  const api = await callUscisApi(receiptNumber);
  if (api.error || api.wait) {
    console.warn(
      `⚠️ API chưa sẵn sàng/ lỗi cho ${receiptNumber}: ${api.message || 'wait'}`
    );
    return { updated: false, reason: api.wait ? 'api_wait' : 'api_error' };
  }

  // Lấy notice từ API (ưu tiên field đã parse sẵn), fallback trích lại từ action_desc mới
  const freshActionDesc = api.action_desc || row.action_desc || '';
  const freshNotice =
    api.notice_date || extractNoticeDate(freshActionDesc) || null;

  if (!freshNotice) {
    console.warn(
      `⚠️ Không trích được notice_date sau khi gọi API: ${receiptNumber}`
    );
    return { updated: false, reason: 'no_date_after_api' };
  }

  // ✅ Update DB: notice_date + đồng bộ action_desc và response_json để nhất quán
  await pool.query(
    `UPDATE uscis 
       SET notice_date = ?, 
           action_desc = ?, 
           status_en = COALESCE(?, status_en),
           updated_at = NOW(),
           response_json = ?
     WHERE receipt_number = ?`,
    [
      freshNotice,
      freshActionDesc,
      api.status_en || null,
      JSON.stringify(api.raw || {}),
      receiptNumber,
    ]
  );

  console.log(
    `✅ Fixed notice_date: ${receiptNumber} | old=${
      currentNotice || 'NULL'
    } → new=${freshNotice}`
  );

  return {
    updated: true,
    old: currentNotice,
    new: freshNotice,
    reason: currentNotice === null ? 'was_null' : 'mismatch_fixed',
  };
}

/**
 * Quét hàng loạt:
 * - Log số dòng sai cần update (n)
 * - Gọi API & cập nhật cho từng dòng mismatch/null
 * @param {{limit?: number, delayMs?: number}} opts
 */
async function fixAllMismatchNoticeDates({ limit = 200, delayMs = 500 } = {}) {
  // Lấy các dòng có khả năng sai: notice_date IS NULL hoặc có action_desc để trích
  const [rows] = await pool.query(
    `SELECT receipt_number, action_desc, notice_date
     FROM uscis
     WHERE notice_date IS NULL 
        OR (action_desc IS NOT NULL AND action_desc <> '')
     ORDER BY updated_at DESC
     LIMIT ?`,
    [limit]
  );

  let needUpdateCount = 0;
  let updatedCount = 0;

  // Xác định trước các dòng cần update (để log n dòng sai)
  const candidates = [];
  for (const r of rows) {
    const extracted = r.action_desc ? extractNoticeDate(r.action_desc) : null;
    const mismatch =
      r.notice_date === null || (extracted && r.notice_date !== extracted);

    if (mismatch) {
      needUpdateCount++;
      candidates.push({
        receipt_number: r.receipt_number,
        old: r.notice_date || 'NULL',
        extracted: extracted || 'N/A',
      });
    }
  }

  // 📋 Log n dòng sai cần update
  if (needUpdateCount > 0) {
    console.log(`📊 Tổng số dòng sai cần update: ${needUpdateCount}`);
    // Log chi tiết (giới hạn 50 dòng cho gọn log)
    const preview = candidates.slice(0, 50);
    preview.forEach((c, i) => {
      console.log(
        `❌ [${i + 1}] ${c.receipt_number} | old=${c.old} | extracted(local)=${
          c.extracted
        }`
      );
    });
    if (candidates.length > preview.length) {
      console.log(`... và ${candidates.length - preview.length} dòng khác`);
    }
  } else {
    console.log('✅ Không có dòng nào sai cần update.');
    return { needUpdateCount: 0, updatedCount: 0 };
  }

  // Thực sự update bằng cách gọi API khi mismatch
  for (const c of candidates) {
    const res = await fixMismatchNoticeDate(c.receipt_number);
    if (res.updated) updatedCount++;
    // tránh spam API
    if (delayMs > 0) await sleep(delayMs);
  }

  console.log(`✅ Đã update: ${updatedCount}/${needUpdateCount}`);

  return { needUpdateCount, updatedCount };
}

module.exports = {
  fixMismatchNoticeDate,
  fixAllMismatchNoticeDates,
};
