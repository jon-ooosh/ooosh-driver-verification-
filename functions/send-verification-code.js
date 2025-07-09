// Netlify Function: Send Email Verification Code (Google Sheets)
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Initialize Google Sheets
const initSheet = async () => {
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/spreadsheets']
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
};

// Generate 6-digit code
const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send email (placeholder - integrate with your preferred service)
const sendEmail = async (email, code, jobName) => {
  // TODO: Integrate with SendGrid, Mailgun, or your email service
  console.log(`Sending code ${code} to ${email} for job ${jobName}`);
  
  // For development, we'll just log it
  // In production, replace with actual email service
  return true;
};

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, jobId } = JSON.parse(event.body);

    // Validate inputs
    if (!email || !jobId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email and jobId are required' })
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }

    const doc = await initSheet();

    // Get jobs sheet
    const jobsSheet = doc.sheetsByTitle['Jobs'] || await doc.addSheet({ title: 'Jobs' });
    
    // Check if job exists and is active
    const jobRows = await jobsSheet.getRows();
    const job = jobRows.find(row => row.get('id') === jobId);

    if (!job) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Job not found' })
      };
    }

    // Check if job is still active and hasn't ended
    const now = new Date();
    const endDate = new Date(job.get('end_date'));
    
    if (job.get('status') !== 'active' || endDate < now) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'This job is no longer accepting verifications' })
      };
    }

    // Generate verification code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // Get or create email verifications sheet
    let emailSheet = doc.sheetsByTitle['EmailVerifications'];
    if (!emailSheet) {
      emailSheet = await doc.addSheet({ 
        title: 'EmailVerifications',
        headerValues: ['email', 'code', 'job_id', 'verified', 'expires_at', 'created_at']
      });
    }

    // Delete any existing unverified codes for this email/job combo
    const existingRows = await emailSheet.getRows();
    for (const row of existingRows) {
      if (row.get('email') === email && 
          row.get('job_id') === jobId && 
          row.get('verified') !== 'TRUE') {
        await row.delete();
      }
    }

    // Add new verification code
    await emailSheet.addRow({
      email: email,
      code: code,
      job_id: jobId,
      verified: 'FALSE',
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString()
    });

    // Send email (in development, this just logs)
    const emailSent = await sendEmail(email, code, job.get('job_name'));

    if (!emailSent) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to send verification email' })
      };
    }

    // Return success (don't include the actual code in production)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({ 
        success: true, 
        message: 'Verification code sent',
        // For development only - remove in production
        debugCode: process.env.NODE_ENV === 'development' ? code : undefined
      })
    });

  } catch (error) {
    console.error('Email verification error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
