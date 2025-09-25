// File: functions/send-confirmation.js
// Sends confirmation email after driver completes verification

const nodemailer = require('nodemailer');

// Create reusable transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'your-email@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD // Use app-specific password
  }
});

exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers, 
      body: JSON.stringify({ error: 'Method not allowed' }) 
    };
  }

  try {
    const { email, jobId, summary, driverName, jobDetails, signatureDate } = JSON.parse(event.body);

    if (!email || !summary) {
      throw new Error('Email and summary are required');
    }

    // Format the insurance questions nicely
    const formatYesNo = (value) => {
      if (value === true || value === 'yes' || value === 'Yes') return 'Yes';
      if (value === false || value === 'no' || value === 'No') return 'No';
      return 'Not answered';
    };

    // Format date nicely
    const formatDate = (dateString) => {
      if (!dateString) return 'Not set';
      return new Date(dateString).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    };

    // Build the HTML email
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px 10px 0 0;
      text-align: center;
    }
    .content {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 0 0 10px 10px;
      padding: 30px;
    }
    .section {
      margin-bottom: 25px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    .section-title {
      font-weight: bold;
      color: #667eea;
      margin-bottom: 10px;
      font-size: 16px;
      border-bottom: 2px solid #667eea;
      padding-bottom: 5px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .info-label {
      color: #666;
    }
    .info-value {
      font-weight: 500;
    }
    .yes { color: #f97316; font-weight: bold; }
    .no { color: #22c55e; font-weight: bold; }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #e0e0e0;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
    .success-badge {
      background: #22c55e;
      color: white;
      padding: 5px 15px;
      border-radius: 20px;
      display: inline-block;
      margin: 10px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🚗 Driver Verification Complete</h1>
    <p class="success-badge">✓ Successfully Verified</p>
  </div>
  
  <div class="content">
    <p>Dear ${driverName},</p>
    
    <p>Thank you for completing your driver verification${jobId ? ` for hire ${jobId}` : ''}. 
    This email confirms that we have received all your information and documents.</p>
    
    ${jobDetails ? `
    <div class="section">
      <div class="section-title">📋 Hire Details</div>
      <div class="info-row">
        <span class="info-label">Job Number:</span>
        <span class="info-value">${jobDetails.jobNumber}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Start Date:</span>
        <span class="info-value">${formatDate(jobDetails.startDate)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">End Date:</span>
        <span class="info-value">${formatDate(jobDetails.endDate)}</span>
      </div>
    </div>
    ` : ''}
    
    <div class="section">
      <div class="section-title">👤 Personal Information</div>
      <div class="info-row">
        <span class="info-label">Name:</span>
        <span class="info-value">${summary.name}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Email:</span>
        <span class="info-value">${summary.email}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Phone:</span>
        <span class="info-value">${summary.phone || 'Not provided'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Nationality:</span>
        <span class="info-value">${summary.nationality}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Date of Birth:</span>
        <span class="info-value">${formatDate(summary.dateOfBirth)}</span>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">🚙 License Information</div>
      <div class="info-row">
        <span class="info-label">License Number:</span>
        <span class="info-value">${summary.licenseNumber}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Issued By:</span>
        <span class="info-value">${summary.licenseIssuedBy}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Valid Until:</span>
        <span class="info-value">${formatDate(summary.licenseValidTo)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Date Passed Test:</span>
        <span class="info-value">${formatDate(summary.datePassedTest)}</span>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">📍 Addresses</div>
      <div class="info-row">
        <span class="info-label">Home Address:</span>
        <span class="info-value">${summary.homeAddress}</span>
      </div>
      <div class="info-row">
        <span class="info-label">License Address:</span>
        <span class="info-value">${summary.licenseAddress}</span>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">🛡️ Insurance Declaration</div>
      <div class="info-row">
        <span class="info-label">Disability/Medical Conditions:</span>
        <span class="${formatYesNo(summary.insuranceQuestions.hasDisability) === 'Yes' ? 'yes' : 'no'}">
          ${formatYesNo(summary.insuranceQuestions.hasDisability)}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">Motoring Convictions:</span>
        <span class="${formatYesNo(summary.insuranceQuestions.hasConvictions) === 'Yes' ? 'yes' : 'no'}">
          ${formatYesNo(summary.insuranceQuestions.hasConvictions)}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">Pending Prosecutions:</span>
        <span class="${formatYesNo(summary.insuranceQuestions.hasProsecution) === 'Yes' ? 'yes' : 'no'}">
          ${formatYesNo(summary.insuranceQuestions.hasProsecution)}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">Accidents (last 5 years):</span>
        <span class="${formatYesNo(summary.insuranceQuestions.hasAccidents) === 'Yes' ? 'yes' : 'no'}">
          ${formatYesNo(summary.insuranceQuestions.hasAccidents)}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">Insurance Issues:</span>
        <span class="${formatYesNo(summary.insuranceQuestions.hasInsuranceIssues) === 'Yes' ? 'yes' : 'no'}">
          ${formatYesNo(summary.insuranceQuestions.hasInsuranceIssues)}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">Driving Bans:</span>
        <span class="${formatYesNo(summary.insuranceQuestions.hasDrivingBan) === 'Yes' ? 'yes' : 'no'}">
          ${formatYesNo(summary.insuranceQuestions.hasDrivingBan)}
        </span>
      </div>
      ${summary.insuranceQuestions.additionalDetails ? `
      <div style="margin-top: 10px; padding: 10px; background: #fff3cd; border-radius: 5px;">
        <strong>Additional Details:</strong><br/>
        ${summary.insuranceQuestions.additionalDetails}
      </div>
      ` : ''}
    </div>
    
    <div class="section">
      <div class="section-title">📄 Document Verification</div>
      <div class="info-row">
        <span class="info-label">Driving License:</span>
        <span class="info-value">${summary.documents.license ? '✅ Verified' : '⏳ Pending'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Proof of Address 1:</span>
        <span class="info-value">${summary.documents.poa1 ? '✅ Verified' : '⏳ Pending'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Proof of Address 2:</span>
        <span class="info-value">${summary.documents.poa2 ? '✅ Verified' : '⏳ Pending'}</span>
      </div>
      ${summary.licenseIssuedBy === 'DVLA' ? `
      <div class="info-row">
        <span class="info-label">DVLA Check:</span>
        <span class="info-value">${summary.documents.dvlaCheck ? '✅ Verified' : '⏳ Pending'}</span>
      </div>
      ` : `
      <div class="info-row">
        <span class="info-label">Passport:</span>
        <span class="info-value">${summary.documents.passport ? '✅ Verified' : '⏳ Pending'}</span>
      </div>
      `}
    </div>
    
    <div class="section">
      <div class="section-title">✍️ Digital Signature</div>
      <p>Your digital signature was captured and saved on <strong>${formatDate(signatureDate)}</strong></p>
    </div>
    
    <p style="margin-top: 20px;">
      <strong>What happens next?</strong><br/>
      We'll review your verification and be in touch if there are any issues. 
      ${jobId ? `Your hire ${jobId} is confirmed and you'll receive further details shortly.` : 'Your verification is complete and valid for future hires.'}
    </p>
    
    <p>If you have any questions, please don't hesitate to contact us.</p>
    
    <p>Best regards,<br/>
    <strong>OOOSH Tours Team</strong></p>
  </div>
  
  <div class="footer">
    <p>This is an automated confirmation email. Please do not reply directly to this message.</p>
    <p>© ${new Date().getFullYear()} OOOSH Tours. All rights reserved.</p>
    <p>
      <a href="https://www.oooshtours.co.uk/files/Ooosh_vehicle_hire_terms.pdf" style="color: #667eea;">
        View Terms & Conditions
      </a>
    </p>
  </div>
</body>
</html>
    `;

    // Plain text version
    const textContent = `
Driver Verification Complete

Dear ${driverName},

Thank you for completing your driver verification${jobId ? ` for hire ${jobId}` : ''}. 
This email confirms that we have received all your information and documents.

${jobId ? `HIRE DETAILS:
- Job Number: ${jobDetails?.jobNumber || jobId}
- Start Date: ${formatDate(jobDetails?.startDate)}
- End Date: ${formatDate(jobDetails?.endDate)}

` : ''}
PERSONAL INFORMATION:
- Name: ${summary.name}
- Email: ${summary.email}
- Phone: ${summary.phone || 'Not provided'}
- Nationality: ${summary.nationality}
- Date of Birth: ${formatDate(summary.dateOfBirth)}

LICENSE INFORMATION:
- License Number: ${summary.licenseNumber}
- Issued By: ${summary.licenseIssuedBy}
- Valid Until: ${formatDate(summary.licenseValidTo)}
- Date Passed Test: ${formatDate(summary.datePassedTest)}

ADDRESSES:
- Home: ${summary.homeAddress}
- License: ${summary.licenseAddress}

INSURANCE DECLARATION:
- Disability/Medical Conditions: ${formatYesNo(summary.insuranceQuestions.hasDisability)}
- Motoring Convictions: ${formatYesNo(summary.insuranceQuestions.hasConvictions)}
- Pending Prosecutions: ${formatYesNo(summary.insuranceQuestions.hasProsecution)}
- Accidents (last 5 years): ${formatYesNo(summary.insuranceQuestions.hasAccidents)}
- Insurance Issues: ${formatYesNo(summary.insuranceQuestions.hasInsuranceIssues)}
- Driving Bans: ${formatYesNo(summary.insuranceQuestions.hasDrivingBan)}
${summary.insuranceQuestions.additionalDetails ? `Additional Details: ${summary.insuranceQuestions.additionalDetails}` : ''}

DOCUMENTS VERIFIED:
- Driving License: ${summary.documents.license ? 'Verified' : 'Pending'}
- Proof of Address 1: ${summary.documents.poa1 ? 'Verified' : 'Pending'}
- Proof of Address 2: ${summary.documents.poa2 ? 'Verified' : 'Pending'}
${summary.licenseIssuedBy === 'DVLA' ? 
  `- DVLA Check: ${summary.documents.dvlaCheck ? 'Verified' : 'Pending'}` : 
  `- Passport: ${summary.documents.passport ? 'Verified' : 'Pending'}`}

Your digital signature was captured on ${formatDate(signatureDate)}.

What happens next?
We'll review your verification and be in touch if there are any issues.
${jobId ? `Your hire ${jobId} is confirmed and you'll receive further details shortly.` : 'Your verification is complete and valid for future hires.'}

If you have any questions, please don't hesitate to contact us.

Best regards,
OOOSH Tours Team

---
This is an automated confirmation email.
© ${new Date().getFullYear()} OOOSH Tours. All rights reserved.
    `;

    // Send email
    const mailOptions = {
      from: `"OOOSH Tours" <${process.env.GMAIL_USER || 'noreply@oooshtours.co.uk'}>`,
      to: email,
      subject: `Driver Verification Complete${jobId ? ` - Hire ${jobId}` : ''}`,
      text: textContent,
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    
    console.log('Confirmation email sent:', info.messageId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        messageId: info.messageId,
        message: 'Confirmation email sent successfully'
      })
    };

  } catch (error) {
    console.error('Error sending confirmation email:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to send confirmation email',
        details: error.message
      })
    };
  }
};
