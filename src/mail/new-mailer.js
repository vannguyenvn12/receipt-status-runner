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

async function sendNewReceipt({ to, receipt, email }) {
  const safeEmail = email?.trim() || '(không có)';

  const mailOptions = {
    from: `"USCIS Notification" <${process.env.MY_MAIL_USER}>`,
    to,
    subject: `📬 THÔNG BÁO: Bạn vừa thêm mới receipt ${receipt} với email ${safeEmail}`,
    html: `
      <div style="font-family: Arial, sans-serif; background-color: #f9f9ff; padding: 20px; border: 1px solid #d0d0ff; border-radius: 8px;">
        <h2 style="color: #1a73e8;">📬 THÔNG BÁO HỆ THỐNG</h2>
        <p style="font-size: 16px; color: #333;">
          Bạn vừa thêm mới một hồ sơ vào hệ thống.
        </p>
        <p style="font-size: 16px; color: #333;">
          <strong>📄 Receipt Number:</strong> <span style="color: #1a73e8;">${receipt}</span>
        </p>
        <p style="font-size: 16px; color: #333;">
          <strong>📧 Email:</strong> <span>${safeEmail}</span>
        </p>
        <hr style="margin: 20px 0;" />
        <p style="font-size: 12px; color: #888;">USCIS Notification System</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(
      `📩 Đã gửi email thông báo thêm mới receipt ${receipt} đến ${to}`
    );
  } catch (error) {
    console.error('❌ Gửi email thông báo thất bại:', error.message);
  }
}

module.exports = sendNewReceipt;
