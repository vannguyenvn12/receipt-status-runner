const db = require('./db/db');
const { extractNoticeDate } = require('./api/uscisApi'); // đã có sẵn

function dateDiffInDays(d1, d2) {
  if (!d1 || !d2) return Infinity;
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  return Math.round((t1 - t2) / (1000 * 60 * 60 * 24));
}

async function checkAndUpdateNoticeDate() {
  // Lấy các hồ sơ có action_desc
  const [rows] = await db.query(`
    SELECT id, receipt_number, action_desc, notice_date
    FROM uscis
    WHERE COALESCE(action_desc,'') <> ''
    ORDER BY id DESC
  `);

  let toUpdate = [];

  for (const row of rows) {
    const extracted = extractNoticeDate(row.action_desc);
    if (!extracted) continue;

    const current = row.notice_date
      ? new Date(row.notice_date).toISOString().split('T')[0]
      : null;

    // Nếu current null thì chắc chắn cần update
    if (!current) {
      toUpdate.push({
        id: row.id,
        receipt: row.receipt_number,
        oldDate: current,
        newDate: extracted,
      });
      continue;
    }

    // Cho phép lệch ±1 ngày
    const diff = Math.abs(dateDiffInDays(current, extracted));
    if (diff > 1) {
      toUpdate.push({
        id: row.id,
        receipt: row.receipt_number,
        oldDate: current,
        newDate: extracted,
      });
    }
  }

  // Log trước khi update
  if (toUpdate.length === 0) {
    console.log('🟡 Không có hồ sơ nào có notice_date cần chỉnh.');
    return;
  }

  console.log(`🔎 Có ${toUpdate.length} hồ sơ cần update notice_date:`);
  toUpdate.forEach((r) =>
    console.log(
      ` - ${r.receipt}: notice_date ${r.oldDate || '(null)'} → ${r.newDate}`
    )
  );

  // Thực hiện update
  let updated = 0;
  for (const r of toUpdate) {
    await db.query(
      `
      UPDATE uscis
      SET notice_date = ?, updated_at = ?
      WHERE id = ?
      `,
      [r.newDate, new Date(), r.id]
    );
    updated++;
  }

  console.log(`✅ Đã cập nhật ${updated} hồ sơ notice_date!`);
}

// Cho phép chạy trực tiếp
if (require.main === module) {
  checkAndUpdateNoticeDate().then(() => process.exit(0));
}

module.exports = {
  checkAndUpdateNoticeDate,
};
