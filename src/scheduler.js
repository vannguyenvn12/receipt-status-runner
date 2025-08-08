const cron = require('node-cron');
const checkUSCISUpdates = require('./checkStatusScheduler');
const { retryProcessEmails, imap } = require('./mail');
const { handleNewReceipt } = require('./handleNewRecept');

console.log('Chạy định kỳ');

let isRunning = false;
let isRunningNewReceipt = false;

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

// NEW RECEIPT: Chạy mỗi 15 phút
cron.schedule('*/15 * * * *', async () => {
  if (isRunningNewReceipt) {
    console.log('⚠️ Đang có phiên NEW RECEIPT đang chạy → bỏ qua lần gọi này');
    return;
  }
  isRunningNewReceipt = true;
  console.log('⏰ Bắt đầu phiên NEW RECEIPT');
  try {
    await handleNewReceipt(); // gọi hàm main() trong handleNewReceipt.js
    console.log('✅ Hoàn tất phiên NEW RECEIPT');
  } catch (err) {
    console.error('💥 Lỗi trong NEW RECEIPT:', err.message);
  } finally {
    isRunningNewReceipt = false;
  }
});
