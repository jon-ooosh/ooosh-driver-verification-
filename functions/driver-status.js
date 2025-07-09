// Netlify Function: Get Driver Status (Google Sheets)
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
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const email = event.queryStringParameters?.email;

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email parameter is required' })
      };
    }

    const doc = await initSheet();

    // Get drivers sheet
    const driversSheet = doc.sheetsByTitle['Drivers'];
    if (!driversSheet) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({ 
          status: 'new',
          message: 'Driver not found in system'
        })
      };
    }

    // Find driver
    const driverRows = await driversSheet.getRows();
    const driver = driverRows.find(row => row.get('email') === email);

    if (!driver) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({ 
          status: 'new',
          message: 'Driver not found in system'
        })
      };
    }

    // Build basic response
    const response = {
      id: driver.get('id'),
      name: driver.get('name') || null,
      email: driver.get('email'),
      phone: driver.get('phone') || null,
      status: 'new'
    };

    // Get verification status if exists
    const verificationsSheet = doc.sheetsByTitle['DriverVerifications'];
    if (verificationsSheet) {
      const verificationRows = await verificationsSheet.getRows();
      const latestVerification = verificationRows
        .filter(row => row.get('driver_id') === driver.get('id'))
        .sort((a, b) => new Date(b.get('updated_at')) - new Date(a.get('updated_at')))[0];

      if (latestVerification) {
        // Determine overall status
        const hasValidDocs = latestVerification.get('license_valid') === 'TRUE' && 
                            latestVerification.get('poa1_valid') === 'TRUE' && 
                            latestVerification.get('poa2_valid') === 'TRUE';
        
        const hasDVLA = latestVerification.get('dvla_check_valid') === 'TRUE';
        
        if (hasValidDocs && hasDVLA && latestVerification.get('insurance_approved') === 'TRUE') {
          response.status = 'verified';
        } else if (latestVerification.get('status') === 'rejected') {
          response.status = 'rejected';
        } else {
          response.status = 'partial';
        }

        // Add document details
        response.documents = {
          license: {
            valid: latestVerification.get('license_valid') === 'TRUE',
            expiryDate: latestVerification.get('license_expiry') || null
          },
          poa1: {
            valid: latestVerification.get('poa1_valid') === 'TRUE',
            type: latestVerification.get('poa1_type') || null,
            expiryDate: latestVerification.get('poa1_expiry') || null
          },
          poa2: {
            valid: latestVerification.get('poa2_valid') === 'TRUE',
            type: latestVerification.get('poa2_type') || null,
            expiryDate: latestVerification.get('poa2_expiry') || null
          },
          dvlaCheck: {
            valid: latestVerification.get('dvla_check_valid') === 'TRUE',
            lastCheck: latestVerification.get('dvla_check_date') || null
          }
        };

        // Add additional info
        response.pointsCount = parseInt(latestVerification.get('points_count')) || 0;
        response.insuranceApproved = latestVerification.get('insurance_approved') === 'TRUE';
        response.lastUpdated = latestVerification.get('updated_at');
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Driver status error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
