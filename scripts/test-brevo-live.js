const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function testBrevo() {
  console.log('─── Testing Live Brevo SMTP ───');
  console.log('Host:', process.env.BREVO_SMTP_HOST);
  console.log('Port:', process.env.BREVO_SMTP_PORT);
  console.log('User:', process.env.BREVO_SMTP_USER);
  console.log('From:', process.env.BREVO_FROM_EMAIL);

  const transporter = nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.BREVO_SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS
    },
    tls: { rejectUnauthorized: false }
  });

  console.log('\n1. Verifying SMTP transport connection...');
  await transporter.verify();
  console.log('✅ SMTP connection established and authenticated successfully.');

  const recipient = process.env.BREVO_FROM_EMAIL || 'kagdeepak45@gmail.com';
  console.log(`\n2. Sending live test email to: ${recipient}...`);

  const info = await transporter.sendMail({
    from: process.env.BREVO_FROM_EMAIL || 'kagdeepak45@gmail.com',
    to: recipient,
    subject: 'Fresh Veggies — Live Brevo SMTP Verification',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #16a34a; margin-top: 0;">🎉 Brevo SMTP Is Fully Operational!</h2>
        <p style="font-size: 15px; color: #374151;">Your Brevo SMTP credentials and relay configuration are connected and verified.</p>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0; font-size: 14px; color: #166534;"><strong>Sender:</strong> ${process.env.BREVO_FROM_EMAIL}</p>
          <p style="margin: 4px 0 0; font-size: 14px; color: #166534;"><strong>Recipient:</strong> ${recipient}</p>
          <p style="margin: 4px 0 0; font-size: 14px; color: #166534;"><strong>Server:</strong> ${process.env.BREVO_SMTP_HOST}:${process.env.BREVO_SMTP_PORT}</p>
          <p style="margin: 4px 0 0; font-size: 14px; color: #166534;"><strong>Timestamp:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
        </div>
        <p style="font-size: 13px; color: #6b7280;">This email confirms that customer order confirmations, status updates, and admin order alerts will be delivered via Brevo.</p>
      </div>
    `
  });

  console.log('✅ Live email sent successfully!');
  console.log('   Message ID:', info.messageId);
  console.log('   Response:', info.response);
  console.log('\n🎉 BREVO LIVE SMTP TEST PASSED 100%!\n');
}

testBrevo().catch(err => {
  console.error('❌ Brevo Test Failed:', err.message);
  if (err.response) console.error('   Server Response:', err.response);
  process.exit(1);
});
