// File: functions/send-confirmation.js
// Sends confirmation email using Google Apps Script (same as verification emails)

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
      if (!dateString || dateString === 'Invalid Date') return 'Not set';
      try {
        return new Date(dateString).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      } catch {
        return 'Not set';
      }
    };

    // Build updated HTML email
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>Dear ${driverName},</p>
        
        <p>Many thanks for completing your hire form for job ${jobId || '[Job ID]'}, which starts ${jobDetails ? formatDate(jobDetails.startDate) : '[Start Date]'}.</p>
        
        <p>Subject to any additional checks that may be required, you will be emailed a completed hire form once the hire has started and the vehicle booked out.</p>
        
        <p style="background-color: #fffbeb; padding: 15px; border-left: 4px solid #fbbf24; margin: 20px 0;">
          <strong>It is important to note that until you have received that confirmation you are NOT insured and you must NOT drive the vehicle.</strong>
        </p>
        
        <p>Please retain this email for your reference - a copy of some of your answers are recorded below for your reference. If you notice anything incorrect with your entered answers please let us know asap.</p>
        
        <p>In the meantime, please also review our driver T&Cs <a href="https://www.oooshtours.co.uk/files/Ooosh_vehicle_hire_terms.pdf" style="color: #667eea;">here</a>.</p>
        
        <h3>Your details</h3>
        <ul>
          <li>Name: ${summary.name}</li>
          <li>Email: ${summary.email}</li>
          <li>Phone: ${summary.phone || 'Not provided'}</li>
          <li>Nationality: ${summary.nationality}</li>
          <li>Date of birth: ${formatDate(summary.dateOfBirth)}</li>
        </ul>
        
        <h3>Licence details</h3>
        <ul>
          <li>Licence number: ${summary.licenseNumber}</li>
          <li>Issued by: ${summary.licenseIssuedBy}</li>
          <li>Valid until: ${formatDate(summary.licenseValidTo)}</li>
          <li>Date passed test: ${formatDate(summary.datePassedTest)}</li>
        </ul>
        
        <h3>Addresses</h3>
        <ul>
          <li>Home address: ${summary.homeAddress}</li>
          <li>Licence address: ${summary.licenseAddress}</li>
        </ul>
        
        <h3>Insurance declaration</h3>
<ul>
  <li>Date Passed Test: ${formatDate(summary.datePassedTest)}</li>
  ${summary.licenseIssuedBy === 'DVLA' && summary.dvlaPoints !== undefined ? `
  <li>Licence points: <strong>${summary.dvlaPoints === 0 ? 'Clean licence' : summary.dvlaPoints + ' points'}</strong></li>
  <li>Endorsements: <strong>${summary.dvlaEndorsements || 'None'}</strong></li>
  <li>Insurance excess (per incident): <strong>${summary.dvlaCalculatedExcess || '£1,200'}</strong></li>
  ` : ''}
  <li>Disability/medical conditions: <strong>${formatYesNo(summary.insuranceQuestions.hasDisability)}</strong></li>
  <li>Motoring convictions: <strong>${formatYesNo(summary.insuranceQuestions.hasConvictions)}</strong></li>
  <li>Pending prosecutions: <strong>${formatYesNo(summary.insuranceQuestions.hasProsecution)}</strong></li>
  <li>Accidents (last 5 years): <strong>${formatYesNo(summary.insuranceQuestions.hasAccidents)}</strong></li>
  <li>Insurance issues: <strong>${formatYesNo(summary.insuranceQuestions.hasInsuranceIssues)}</strong></li>
  <li>Driving bans: <strong>${formatYesNo(summary.insuranceQuestions.hasDrivingBan)}</strong></li>
</ul>
        ${summary.insuranceQuestions.additionalDetails ? `
        <p><strong>Additional details:</strong> ${summary.insuranceQuestions.additionalDetails}</p>
        ` : ''}
        
        <h3>Documents Verified</h3>
<ul>
  <li>Driving licence: ${summary.documents.license ? '✅ Verified' : '⏳ Pending'}</li>
  <li>Proof of address 1: ${summary.documents.poa1 ? '✅ Verified' : '⏳ Pending'}</li>
  <li>Proof of address 2: ${summary.documents.poa2 ? '✅ Verified' : '⏳ Pending'}</li>
  ${summary.licenseIssuedBy === 'DVLA' ? 
    `<li>DVLA check: ${summary.documents.dvlaCheck ? '✅ Verified' : '⏳ Pending'}</li>` : 
    `<li>Passport: ${summary.documents.passport ? '✅ Verified' : '⏳ Pending'}</li>`
  }
</ul>
        
        <p>Your digital signature was captured on <strong>${formatDate(signatureDate)}</strong></p>
        
        <p>If you have any questions, please don't hesitate to contact us.</p>
        
        <p>Thanks,<br>
        <strong>Ooosh Tours</strong></p>
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
        action: 'send-confirmation',  // Using hyphenated format
        email: email,
        subject: `Hire form completed - Job ${jobId || ''}`,
        htmlBody: htmlContent,
        fromEmail: 'info@oooshtours.co.uk',
        fromName: 'Ooosh Tours'
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
