const db = require('./db/db');
const { extractNoticeDate } = require('./api/uscisApi'); // đã có sẵn

async function checkAndUpdateNoticeDate() {
  // Lấy các hồ sơ có action_desc
  const [rows] = await db.query(`
    SELECT id, receipt_number, action_desc, notice_date
    FROM uscis
    WHERE COALESCE(action_desc,'') <> ''
    ORDER BY id DESC
    LIMIT 500
  `);

  let toUpdate = [];

  for (const row of rows) {
    const extracted = extractNoticeDate(row.action_desc);
    if (!extracted) continue;

    const current = row.notice_date
      ? new Date(row.notice_date).toISOString().split('T')[0]
      : null;

    if (current !== extracted) {
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
    console.log('🟡 Không có hồ sơ nào có notice_date khác.');
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
