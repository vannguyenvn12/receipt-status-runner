const db = require('./db/db');
const { callUscisApi } = require('./api/uscisApi');
const sendStatusUpdateMail = require('./mail/mailer');
const { toSQLDateTime, toVietnameseDateString } = require('./utils/day');
const path = require('path');
const { mkdir, appendFile } = require('fs').promises;

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = () =>
  path.join(LOG_DIR, `uscis_meta_update_${new Date().toISOString().slice(0,10)}.log`);


const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function checkUSCISUpdates() {
  try {
    const [rows] = await db.query(`
      SELECT u.*
      FROM uscis u
      JOIN setting_uscis_phase_group s ON u.status_en = s.english_status
      WHERE s.update_hour > 0
        AND TIMESTAMPDIFF(MINUTE, u.updated_at, NOW()) >= s.update_hour * 60
    `);

    if (!rows.length) {
      console.log('✅ Không có hồ sơ nào cần cập nhật.');
      return;
    }

    for (const row of rows) {
      try {
        let retry = 0;
        const maxRetries = 3;
        let result = null;

        while (retry < maxRetries) {
          console.log(`🔍 Kiểm tra: ${row.receipt_number} (lần ${retry + 1})`);

          result = await callUscisApi(row.receipt_number);

          if (result.wait) {
            console.log(
              `⏸ Server yêu cầu đợi... nghỉ 1 phút (${row.receipt_number})`
            );
            await sleep(60000);
            retry++;
            continue;
          }

          if (result.error || !result.status_en) {
            console.warn(
              `⚠️ API lỗi hoặc không hợp lệ: ${result.message || 'unknown'}`
            );
            break;
          }

          break;
        }

        if (!result || result.wait || result.error || !result.status_en) {
          console.warn(`⚠️ Bỏ qua ${row.receipt_number} sau ${retry} lần`);
          continue;
        }

        const newStatusEn = result.status_en;
        const newActionDesc = result.action_desc;

        if (newStatusEn === row.status_en) {
          const needMetaUpdate =
            (newActionDesc && newActionDesc !== row.action_desc) ||
            (result.notice_date && result.notice_date !== row.notice_date) ||
            (result.form_info && result.form_info !== row.form_info);

          if (needMetaUpdate) {
            await db.query(
              `UPDATE uscis SET
                action_desc = ?,
                notice_date = COALESCE(?, notice_date),
                form_info   = COALESCE(?, form_info),
                response_json = ?,
                updated_at = NOW(),
                status_update = FALSE
              WHERE receipt_number = ?`,
              [
                newActionDesc,
                result.notice_date || null,
                result.form_info || null,
                JSON.stringify(result.raw),
                row.receipt_number,
              ]
            );

            try {
              await mkdir(LOG_DIR, { recursive: true });

              const safe = (s) => (s ?? '').toString().replace(/\s+/g, ' ').slice(0, 500);
              const line =
                `[${new Date().toISOString()}] META-UPDATE ${row.receipt_number} ` +
                `old_notice=${row.notice_date ?? ''} -> new_notice=${result.notice_date ?? ''} | ` +
                `old_form=${safe(row.form_info)} -> new_form=${safe(result.form_info)} | ` +
                `old_action=${safe(row.action_desc)} ||| new_action=${safe(newActionDesc)}\n`;

              await appendFile(LOG_FILE(), line, 'utf8');
            } catch (e) {
              console.warn('⚠️ Ghi log TXT thất bại:', e.message);
            }

            console.log(`↪️ [Định kỳ]: Cập nhật meta (notice_date/form_info/action_desc): ${row.receipt_number}`);
          } else {
            await db.query(`UPDATE uscis SET updated_at = NOW() WHERE receipt_number = ?`, [row.receipt_number]);
            console.log(`↪️ [Định kỳ]: Không thay đổi: ${row.receipt_number}`);
          }

          await sleep(5000);
          continue;
        }


        const [[map]] = await db.query(
          `SELECT vietnamese_status FROM setting_uscis_phase_group WHERE english_status = ?`,
          [newStatusEn]
        );
        const newStatusVi = map?.vietnamese_status || null;

        // Ghi log trước khi update
        await db.query(
          `INSERT INTO status_log (
            receipt_number, email, updated_at_log, updated_at_status,
            action_desc, status_en, status_vi, notice_date,
            form_info, response_json, retries, has_receipt
          ) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
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
          ]
        );

        const date = new Date().toISOString();

        // Cập nhật trạng thái mới
        await db.query(
          `UPDATE uscis SET
            status_en = ?, status_vi = ?, action_desc = ?,
            updated_at = NOW(), updated_status_at = ?, notice_date = COALESCE(?, notice_date), form_info = ?,
            response_json = ?, retries = 0, status_update = TRUE
          WHERE receipt_number = ?`,
          [
            newStatusEn,
            newStatusVi,
            newActionDesc,
            toSQLDateTime(date),
            result.notice_date || null,
            result.form_info,
            JSON.stringify(result.raw),
            row.receipt_number,
          ]
        );

        console.log(
          `✅ [Định kỳ] Cập nhật: ${row.receipt_number} → ${newStatusEn}`
        );

        // Gửi email nếu có thay đổi
        await sendStatusUpdateMail({
          to: process.env.MAIL_NOTIFY,
          receipt: row.receipt_number,
          content: newActionDesc,
          email: row.email || 'Không có email',
          formInfo: result.form_info,
          bodyDate: toVietnameseDateString(date),
          status_en: newStatusEn,
          status_vi: newStatusVi,
        });

        console.log(
          `📧 [Định kỳ]: Đã gửi email thông báo cho ${
            row.email || 'MAIL_NOTIFY'
          }`
        );
      } catch (err) {
        console.error(
          `💥[Định kỳ]: Lỗi xử lý ${row.receipt_number}:`,
          err.message
        );
      }

      await sleep(5000);
    }
  } catch (err) {
    console.error('❌ [Định kỳ]: Lỗi hệ thống:', err.message);
  }
}

module.exports = checkUSCISUpdates;
