const cron = require('node-cron');
const checkUSCISUpdates = require('./checkStatusScheduler');
const { retryProcessEmails, imap } = require('./mail');
const { handleNewReceipt } = require('./handleNewRecept');
const { handleRetryInvalid } = require('./retryInvalidReceipts');

console.log('Chạy định kỳ');

let isRunning = false;
let isRunningNewReceipt = false;
let isRunningRetryInvalid = false; // ⬅️ flag mới

// USCIS: chạy mỗi 30 phút
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

// EMAIL: chạy mỗi 30 phút
// cron.schedule('*/30 * * * *', () => {
//   if (!imap || !imap.state || imap.state !== 'authenticated') {
//     console.log('⚠️ IMAP chưa kết nối, bỏ qua retry');
//     return;
//   }

//   console.log('⏰ Bắt đầu phiên EMAIL');
//   retryProcessEmails();
// });

// NEW RECEIPT: chạy mỗi 15 phút
cron.schedule('*/15 * * * *', async () => {
  if (isRunningNewReceipt) {
    console.log('⚠️ Đang có phiên NEW RECEIPT đang chạy → bỏ qua lần gọi này');
    return;
  }
  isRunningNewReceipt = true;
  console.log('⏰ Bắt đầu phiên NEW RECEIPT');
  try {
    await handleNewReceipt();
    console.log('✅ Hoàn tất phiên NEW RECEIPT');
  } catch (err) {
    console.error('💥 Lỗi trong NEW RECEIPT:', err.message);
  } finally {
    isRunningNewReceipt = false;
  }
});

// RETRY INVALID: chạy mỗi 60 phút
// cron.schedule('0 * * * *', async () => {
//   if (isRunningRetryInvalid) {
//     console.log('⚠️ Đang có phiên RETRY INVALID đang chạy → bỏ qua lần gọi này');
//     return;
//   }
//   isRunningRetryInvalid = true;
//   console.log('⏰ Bắt đầu phiên RETRY INVALID');
//   try {
//     await handleRetryInvalid(); // gọi hàm main() trong retryInvalidReceipts.js
//     console.log('✅ Hoàn tất phiên RETRY INVALID');
//   } catch (err) {
//     console.error('💥 Lỗi trong RETRY INVALID:', err.message);
//   } finally {
//     isRunningRetryInvalid = false;
//   }
// });
