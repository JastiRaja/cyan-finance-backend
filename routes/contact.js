const express = require('express');
const router = express.Router();
const SibApiV3Sdk = require('sib-api-v3-sdk');

// POST /api/contact
router.post('/', async (req, res) => {
  const { name, email, phone, gold, message } = req.body;
  if (!name || !email || !phone || !gold || !message) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  // Brevo (Sendinblue) setup
  const adminEmail = process.env.ADMIN_EMAIL;
  const senderEmail = process.env.EMAIL_FROM;
  const brevoApiKey = process.env.BREVO_API_KEY;

  if (!adminEmail || !senderEmail || !brevoApiKey) {
    return res.status(500).json({ success: false, message: 'Email configuration missing on server.' });
  }

  SibApiV3Sdk.ApiClient.instance.authentications['api-key'].apiKey = brevoApiKey;
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const sendSmtpEmail = {
    to: [{ email: adminEmail }],
    sender: { email: senderEmail, name: 'Cyan Finance Contact Form' },
    subject: 'New Contact Form Submission',
    htmlContent: `<h2>Contact Form Submission</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Gold Amount:</strong> ${gold}</p>
      <p><strong>Message:</strong><br/>${message}</p>`
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    res.json({ success: true, message: 'Contact form submitted and email sent to admin.' });
  } catch (error) {
    console.error('Brevo email error:', error);
    res.status(500).json({ success: false, message: 'Failed to send email. Please try again later.' });
  }
});

module.exports = router; 