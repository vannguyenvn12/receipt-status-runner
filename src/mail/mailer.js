const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.MY_MAIL_USER,
    pass: process.env.MY_MAIL_PASS,
  },
});

async function sendStatusUpdateMail({ to, receipt, status_en, status_vi }) {
  const mailOptions = {
    from: `"USCIS Notification" <${process.env.MY_MAIL_USER}>`,
    to,
    subject: `📬 USCIS Update: ${receipt}`,
    html: `
      <p>✅ <strong>Receipt Number:</strong> ${receipt}</p>
      <p>🔁 <strong>Trạng thái mới:</strong> ${status_en} — ${status_vi}</p>
      <p>⏱️ <em>Thời gian:</em> ${new Date().toLocaleString()}</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📩 Email đã gửi đến ${to} (${receipt})`);
  } catch (error) {
    console.error('❌ Gửi email thất bại:', error.message);
  }
}

module.exports = sendStatusUpdateMail;
