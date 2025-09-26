// File: functions/send-confirmation.js
// Sends confirmation email using Google Apps Script (same as verification emails)

const fetch = require('node-fetch');

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

    // Build a simple HTML summary
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">Driver Verification Complete</h2>
        
        <p>Dear ${driverName},</p>
        
        <p>Thank you for completing your driver verification${jobId ? ` for hire ${jobId}` : ''}.</p>
        
        ${jobDetails ? `
        <h3>Hire Details</h3>
        <ul>
          <li>Job Number: ${jobDetails.jobNumber}</li>
          <li>Start Date: ${formatDate(jobDetails.startDate)}</li>
          <li>End Date: ${formatDate(jobDetails.endDate)}</li>
        </ul>
        ` : ''}
        
        <h3>Your Information</h3>
        <ul>
          <li>Name: ${summary.name}</li>
          <li>Email: ${summary.email}</li>
          <li>Phone: ${summary.phone || 'Not provided'}</li>
          <li>Nationality: ${summary.nationality}</li>
          <li>Date of Birth: ${formatDate(summary.dateOfBirth)}</li>
        </ul>
        
        <h3>License Information</h3>
        <ul>
          <li>Licence Number: ${summary.licenseNumber}</li>
          <li>Issued By: ${summary.licenseIssuedBy}</li>
          <li>Valid Until: ${formatDate(summary.licenseValidTo)}</li>
          <li>Date Passed Test: ${formatDate(summary.datePassedTest)}</li>
        </ul>
        
        <h3>Addresses</h3>
        <ul>
          <li>Home Address: ${summary.homeAddress}</li>
          <li>Licence Address: ${summary.licenseAddress}</li>
        </ul>
        
        <h3>Insurance Declaration</h3>
        <ul>
          <li>Disability/Medical Conditions: <strong>${formatYesNo(summary.insuranceQuestions.hasDisability)}</strong></li>
          <li>Motoring Convictions: <strong>${formatYesNo(summary.insuranceQuestions.hasConvictions)}</strong></li>
          <li>Pending Prosecutions: <strong>${formatYesNo(summary.insuranceQuestions.hasProsecution)}</strong></li>
          <li>Accidents (last 5 years): <strong>${formatYesNo(summary.insuranceQuestions.hasAccidents)}</strong></li>
          <li>Insurance Issues: <strong>${formatYesNo(summary.insuranceQuestions.hasInsuranceIssues)}</strong></li>
          <li>Driving Bans: <strong>${formatYesNo(summary.insuranceQuestions.hasDrivingBan)}</strong></li>
        </ul>
        ${summary.insuranceQuestions.additionalDetails ? `
        <p><strong>Additional Details:</strong> ${summary.insuranceQuestions.additionalDetails}</p>
        ` : ''}
        
        <h3>Documents Verified</h3>
        <ul>
          <li>Driving Licence: ${summary.documents.license ? '✅ Verified' : '⏳ Pending'}</li>
          <li>Proof of Address 1: ${summary.documents.poa1 ? '✅ Verified' : '⏳ Pending'}</li>
          <li>Proof of Address 2: ${summary.documents.poa2 ? '✅ Verified' : '⏳ Pending'}</li>
          ${summary.licenseIssuedBy === 'DVLA' ? 
            `<li>DVLA Check: ${summary.documents.dvlaCheck ? '✅ Verified' : '⏳ Pending'}</li>` : 
            `<li>Passport: ${summary.documents.passport ? '✅ Verified' : '⏳ Pending'}</li>`
          }
        </ul>
        
        <p>Your digital signature was captured on <strong>${formatDate(signatureDate)}</strong></p>
        
        <p>If you have any questions, please don't hesitate to contact us.</p>
        
        <p>Thanks,<br>
        <strong>Ooosh Tours</strong></p>
        
        <hr style="margin-top: 30px;">
        <p style="font-size: 12px; color: #666;">
          This is an automated confirmation email. 
          <a href="https://www.oooshtours.co.uk/files/Ooosh_vehicle_hire_terms.pdf">View Terms & Conditions</a>
        </p>
      </div>
    `;

    // Call your Google Apps Script to send the email
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    
    if (!scriptUrl) {
      throw new Error('Google Apps Script URL not configured');
    }

    console.log('Sending confirmation email via Google Apps Script');
    
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'sendConfirmation',
        email: email,
        subject: `Driver Verification Complete${jobId ? ` - Hire ${jobId}` : ''}`,
        htmlBody: htmlContent,
        fromEmail: 'info@oooshtours.co.uk',
        fromName: 'OOOSH Tours'
      })
    });

    const result = await response.text();
    console.log('Google Apps Script response:', result);

    if (!response.ok) {
      throw new Error(`Failed to send email via Google Apps Script: ${result}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Confirmation email sent successfully via Google Apps Script',
        recipient: email
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
