const cron = require('node-cron');
const { exec } = require('child_process');

cron.schedule('*/30 * * * *', () => {
  console.log('⏰ Đang chạy kiểm tra định kỳ USCIS...');
  exec('node checkStatusScheduler.js');
});
