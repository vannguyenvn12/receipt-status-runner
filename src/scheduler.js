const cron = require('node-cron');
const checkUSCISUpdates = require('./checkStatusScheduler');

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
