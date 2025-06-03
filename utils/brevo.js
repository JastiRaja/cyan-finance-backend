const axios = require('axios');

const sendBrevoEmail = async ({ to, subject, html }) => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail=process.env.EMAIL_FROM;
  if (!apiKey) throw new Error('Missing BREVO_API_KEY');

  const data = {
    sender: { name: 'Cyan Finance', email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html
  };

  await axios.post('https://api.brevo.com/v3/smtp/email', data, {
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    }
  });
};

module.exports = { sendBrevoEmail }; 