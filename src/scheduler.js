const cron = require('node-cron');
const { exec } = require('child_process');

console.log('Chạy định kỳ');

cron.schedule('*/30 * * * *', () => {
  console.log('⏰ Đang chạy kiểm tra định kỳ USCIS...');
  exec('node src/checkStatusScheduler.js');
});
