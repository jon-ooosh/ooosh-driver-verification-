// Netlify Function: Verify Email Code (Google Sheets)
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

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, code, jobId } = JSON.parse(event.body);

    // Validate inputs
    if (!email || !code || !jobId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email, code, and jobId are required' })
      };
    }

    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid code format' })
      };
    }

    const doc = await initSheet();

    // Get email verifications sheet
    const emailSheet = doc.sheetsByTitle['EmailVerifications'];
    if (!emailSheet) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No verification codes found' })
      };
    }

    // Check verification code
    const rows = await emailSheet.getRows();
    const verification = rows
      .filter(row => row.get('email') === email && 
                    row.get('code') === code && 
                    row.get('job_id') === jobId)
      .sort((a, b) => new Date(b.get('created_at')) - new Date(a.get('created_at')))[0];

    if (!verification) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid verification code' })
      };
    }

    // Check if already verified
    if (verification.get('verified') === 'TRUE') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Code already used' })
      };
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(verification.get('expires_at'));
    
    if (now > expiresAt) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Verification code expired' })
      };
    }

    // Mark code as verified
    verification.set('verified', 'TRUE');
    await verification.save();

    // Create or update driver record
    let driversSheet = doc.sheetsByTitle['Drivers'];
    if (!driversSheet) {
      driversSheet = await doc.addSheet({ 
        title: 'Drivers',
        headerValues: ['id', 'email', 'name', 'phone', 'created_at', 'updated_at']
      });
    }

    let driverId;
    const driverRows = await driversSheet.getRows();
    const existingDriver = driverRows.find(row => row.get('email') === email);

    if (existingDriver) {
      driverId = existingDriver.get('id');
      existingDriver.set('updated_at', new Date().toISOString());
      await existingDriver.save();
    } else {
      // Generate new driver ID
      driverId = Date.now().toString();
      await driversSheet.addRow({
        id: driverId,
        email: email,
        name: '',
        phone: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({ 
        success: true,
        message: 'Email verified successfully',
        driverId: driverId
      })
    };

  } catch (error) {
    console.error('Code verification error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
