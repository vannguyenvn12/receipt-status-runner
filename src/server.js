const express = require('express');
const app = express();
require('dotenv').config();
const uscisRoutes = require('./routes/uscis');

app.use(express.json({ limit: '10mb' })); // tăng limit nếu cần

require('./mail'); // 👈 Gọi mail listener (imap)
require('./scheduler'); // 👈 Chạy định kỳ

app.use('/api/uscis', uscisRoutes);

app.get('/', (req, res) => {
  res.json({ msg: 'ok' });
});

// Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
