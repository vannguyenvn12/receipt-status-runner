const cron = require('node-cron');
const { exec } = require('child_process');
const checkUSCISUpdates = require('./checkStatusScheduler');

console.log('Chạy định kỳ');

cron.schedule('*/30 * * * *', () => {
  console.log('⏰ Đang chạy kiểm tra định kỳ USCIS...');
  checkUSCISUpdates();
});
