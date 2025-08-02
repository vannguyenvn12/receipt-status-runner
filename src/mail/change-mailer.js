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

async function sendEmailChanged({ to, receipt, oldEmail, newEmail }) {
  const mailOptions = {
    from: `"USCIS Notification" <${process.env.MY_MAIL_USER}>`,
    to,
    subject: `📬 THÔNG BÁO: Cập nhật email cho receipt ${receipt}`,
    html: `
      <div style="font-family: Arial, sans-serif; background-color: #f9f9ff; padding: 20px; border: 1px solid #d0d0ff; border-radius: 8px;">
        <h2 style="color: #1a73e8;">🔄 EMAIL ĐÃ ĐƯỢC CẬP NHẬT</h2>
        <p><strong>📄 Receipt Number:</strong> ${receipt}</p>
        <p><strong>📧 Email cũ:</strong> ${oldEmail}</p>
        <p><strong>📧 Email mới:</strong> ${newEmail}</p>
        <hr style="margin: 20px 0;" />
        <p style="font-size: 12px; color: #888;">USCIS Notification System</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📩 Đã gửi mail thông báo đổi email cho ${receipt}`);
  } catch (err) {
    console.error('❌ Gửi email thông báo đổi email thất bại:', err.message);
  }
}

module.exports = sendEmailChanged;
