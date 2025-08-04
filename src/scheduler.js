const cron = require('node-cron');
const checkUSCISUpdates = require('./checkStatusScheduler');
const { retryProcessEmails, imap } = require('./mail');

console.log('Chạy định kỳ');

let isRunning = false;
cron.schedule('*/30 * * * *', async () => {
  if (isRunning) {
    console.log('⚠️ Đang có phiên USCIS đang chạy → bỏ qua lần gọi này');
    return;
  }

  isRunning = true;
  console.log('⏰ Bắt đầu phiên USCIS');

  try {
    await checkUSCISUpdates();
    console.log('✅ Hoàn tất phiên USCIS');
  } catch (err) {
    console.error('💥 Lỗi trong USCIS:', err.message);
  } finally {
    isRunning = false;
  }
});

// Chạy mỗi 30 phút
cron.schedule('*/30 * * * *', () => {
  if (!imap || !imap.state || imap.state !== 'authenticated') {
    console.log('⚠️ IMAP chưa kết nối, bỏ qua retry');
    return;
  }

  console.log('⏰ Bắt đầu phiên EMAIL');
  retryProcessEmails();
});
