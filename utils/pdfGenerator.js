const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

async function generatePaymentReceiptPDF({
  customerName,
  paymentAmount,
  totalPaid,
  totalLoan,
  toBePaid,
  paymentDate,
  loanId,
  logoPath
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      resolve(pdfData);
    });

    // Logo
    if (logoPath && fs.existsSync(logoPath)) {
      doc.image(logoPath, 20, 20, { width: 60 });
    }
    doc.fontSize(20).text('Payment Receipt', 200, 40);
    doc.moveDown();

    // Office details
    doc.fontSize(10).text('Cyan Finance', 50, 100);
    doc.text('BK Towers, Akkayyapalem, Visakhapatnam, Andra Pradesh-530016.');
    doc.text('Phone: +91-9700049444');
    doc.text('Email: support@cyanfinance.in');
    doc.moveDown();

    // Customer & Payment details
    doc.fontSize(12).text(`Date: ${paymentDate}`);
    doc.text(`Receipt No: ${loanId}`);
    doc.text(`Customer Name: ${customerName}`);
    doc.moveDown();

    doc.fontSize(14).text('Payment Details:', { underline: true });
    doc.fontSize(12).text(`Payment Amount: INR ${paymentAmount}`);
    doc.text(`Total Paid: INR ${totalPaid}`);
    doc.text(`Total Loan Amount: INR ${totalLoan}`);
    doc.text(`To Be Paid: INR ${toBePaid}`);
    doc.moveDown();

    doc.text('Thank you for your payment!', { align: 'center' });

    doc.end();
  });
}

module.exports = { generatePaymentReceiptPDF }; 