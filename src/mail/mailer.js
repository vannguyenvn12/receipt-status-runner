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

async function sendStatusUpdateMail({
  to,
  receipt,
  status_en,
  status_vi,
  content,
  email,
  bodyDate,
  formInfo,
}) {
  const mailOptions = {
    from: `"USCIS Notification" <${process.env.MY_MAIL_USER}>`,
    to,
    subject: `📬 USCIS Update: ${receipt}`,
    html: `
        <p>📧 <strong>Email:</strong> ${email}</p>
        <p>📬 <strong>Receipt Number:</strong> ${receipt}</p>
        <p>📄 <strong>Trạng thái:</strong> ${status_en}</p>
        <p>📄 <strong>Form Info:</strong> ${formInfo}</p>
        <p>⏰ <strong>Thời gian cập nhật:</strong> ${bodyDate}</p>
        <p>📝 <strong>Nội dung:</strong> ${content}</p>
        `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    const messageId = info?.messageId || null;
    console.log(`📩 Email đã gửi đến ${to} (${receipt}) — messageId=${messageId}`);
    return { messageId };
  } catch (error) {
    console.error('❌ Gửi email thất bại:', error.message);
    return { messageId: null, error: error.message };
  }
}

module.exports = sendStatusUpdateMail;
