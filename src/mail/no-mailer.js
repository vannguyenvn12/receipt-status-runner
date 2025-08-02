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

async function sendNoEmailStatus({ to, email }) {
  const mailOptions = {
    from: `"USCIS Notification" <${process.env.MY_MAIL_USER}>`,
    to,
    subject: '⚠️ Cảnh báo',
    html: `
      <div style="font-family: Arial, sans-serif; background-color: #fff8f8; padding: 20px; border: 1px solid #ffcfcf; border-radius: 8px;">
        <h2 style="color: #d93025;">⚠️ CẢNH BÁO HỆ THỐNG</h2>
        <p style="font-size: 16px; color: #333;">
          Hệ thống phát hiện một địa chỉ email không tồn tại trong hệ thống.
        </p>
        <p style="font-size: 16px; color: #d93025;">
          <strong>Email không hợp lệ:</strong> <span style="background-color: #ffecec; padding: 4px 8px; border-radius: 4px;">${email}</span>
        </p>
        <p style="font-size: 14px; color: #666;">
          Vui lòng kiểm tra lại địa chỉ email hoặc cập nhật thông tin đúng để tiếp tục nhận thông báo từ hệ thống.
        </p>
        <hr style="margin: 20px 0;" />
        <p style="font-size: 12px; color: #aaa;">USCIS Notification System</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📩 Email cảnh báo đã gửi đến ${to}`);
  } catch (error) {
    console.error('❌ Gửi email cảnh báo thất bại:', error.message);
  }
}

module.exports = sendNoEmailStatus;
