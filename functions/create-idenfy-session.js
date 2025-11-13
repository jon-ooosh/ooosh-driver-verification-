// File: functions/create-idenfy-session.js
// Ooosh Tours Driver Verification - Create Idenfy Session
// Production-ready version with security hardening

/**
 * Validate email format
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if valid format
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  return (
    emailRegex.test(email) &&
    email.length <= 254 &&
    email.length >= 6 &&
    !email.includes('..') &&
    !email.startsWith('.') &&
    !email.endsWith('.')
  );
}

/**
 * Sanitize email for use in client ID
 * @param {string} email - Email to sanitize
 * @returns {string} - Sanitized email safe for URLs
 */
function sanitizeEmailForClientId(email) {
  return email
    .toLowerCase()
    .trim()
    .replace(/@/g, '_at_')
    .replace(/\./g, '_dot_')
    .replace(/[^a-z0-9_]/g, ''); // Remove any other special chars
}

exports.handler = async (event) => {
  // 🔒 SECURITY: CORS headers - Allow both domains for future migration
  const headers = {
    'Access-Control-Allow-Origin': 
      event.headers.origin === 'https://www.oooshtours.co.uk' || 
      event.headers.origin === 'https://oooshtours.co.uk'
        ? event.headers.origin
        : 'https://ooosh-driver-verification.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Validate request body exists
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    // Parse and validate request data
    let email, jobId, driverName, verificationType, isUKDriver;
    try {
      const parsed = JSON.parse(event.body);
      email = parsed.email;
      jobId = parsed.jobId;
      driverName = parsed.driverName;
      verificationType = parsed.verificationType || 'full';
      isUKDriver = parsed.isUKDriver !== false; // Default true
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    // Validate required fields
    if (!email || !jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and jobId are required' })
      };
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }

    console.log('✅ Creating Idenfy session:', { verificationType, isUKDriver });

    // 🔒 SECURITY: Ensure Idenfy credentials are configured
    if (!process.env.IDENFY_API_KEY || !process.env.IDENFY_API_SECRET) {
      console.error('❌ Idenfy credentials not configured');
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ 
          error: 'Identity verification service temporarily unavailable' 
        })
      };
    }

    // Handle special case: All documents valid, skip to signature
    if (verificationType === 'none') {
      console.log('✅ All documents valid, skipping Idenfy');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          skipIdenfy: true,
          message: 'All documents valid, proceed to signature',
          redirectUrl: `https://ooosh-driver-verification.netlify.app/?status=skip&job=${jobId}&email=${encodeURIComponent(email)}&type=signature`
        })
      };
    }

    // Create Idenfy session
    const idenfyResponse = await createIdenfySession(
      email, 
      jobId, 
      verificationType, 
      isUKDriver
    );
    
    if (!idenfyResponse.success) {
      throw new Error(idenfyResponse.error || 'Failed to create Idenfy session');
    }

    // Update driver verification status
    await updateDriverVerificationStatus(email, jobId, {
      idenfySessionId: idenfyResponse.scanRef,
      idenfyStatus: 'initiated',
      verificationType: verificationType,
      status: 'document_upload_started'
    });

    console.log('✅ Idenfy session created successfully');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        sessionToken: idenfyResponse.sessionToken,
        scanRef: idenfyResponse.scanRef,
        clientId: idenfyResponse.clientId,
        redirectUrl: idenfyResponse.redirectUrl,
        verificationType: verificationType,
        documentsRequired: idenfyResponse.documentsRequired,
        message: 'Idenfy session created successfully'
      })
    };

  } catch (error) {
    console.error('❌ Create Idenfy session error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to create identity verification session',
        details: error.message 
      })
    };
  }
};

/**
 * Create Idenfy verification session with specified document requirements
 * @param {string} email - Driver email
 * @param {string} jobId - Job ID
 * @param {string} verificationType - Type of verification needed
 * @param {boolean} isUKDriver - Whether driver has UK license
 * @returns {Promise<Object>} - Session creation result
 */
async function createIdenfySession(email, jobId, verificationType, isUKDriver) {
  try {
    const apiKey = process.env.IDENFY_API_KEY;
    const apiSecret = process.env.IDENFY_API_SECRET;
    const IDENFY_BASE_URL = 'https://ivs.idenfy.com';
    
    // Create unique client ID with email for webhook processing
    const encodedEmail = sanitizeEmailForClientId(email);
    const clientId = `ooosh_${jobId}_${encodedEmail}_${Date.now()}`;
    
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    console.log('🔑 Creating Idenfy session with client ID:', clientId);

    // Fetch driver data for COMPARE validation (revalidations only)
    let firstName = null;
    let lastName = null;
    let dateOfBirth = null;
    
    if (verificationType !== 'full') {
      try {
        console.log('🔍 Fetching driver data for COMPARE validation');
        const driverResponse = await fetch(
          `${process.env.URL}/.netlify/functions/driver-status?email=${encodeURIComponent(email)}`
        );
        
        if (driverResponse.ok) {
          const driverData = await driverResponse.json();
          
          firstName = driverData.firstName;
          lastName = driverData.lastName;
          dateOfBirth = driverData.dateOfBirth;
          
          if (firstName && lastName) {
            console.log('✅ COMPARE data loaded');
          }
        }
      } catch (error) {
        console.log('⚠️ Could not fetch driver data:', error.message);
      }
    }

    // Base configuration
    const requestBody = {
      clientId: clientId,
      successUrl: `https://ooosh-driver-verification.netlify.app/?step=processing-hub&job=${jobId}&email=${encodeURIComponent(email)}&sessionType=${verificationType}`,
      errorUrl: `https://ooosh-driver-verification.netlify.app/?step=processing-hub&job=${jobId}&email=${encodeURIComponent(email)}&sessionType=${verificationType}&error=true`,
      unverifiedUrl: `https://ooosh-driver-verification.netlify.app/?step=processing-hub&job=${jobId}&email=${encodeURIComponent(email)}&sessionType=${verificationType}&unverified=true`,
      locale: 'en',
      expiryTime: 3600,
      sessionLength: 1800,
      tokenType: 'IDENTIFICATION',
      showInstructions: true
    };
    
    // Add COMPARE data if available
    if (firstName && lastName) {
      requestBody.firstName = firstName;
      requestBody.lastName = lastName;
    }
    
    if (dateOfBirth) {
      requestBody.dateOfBirth = dateOfBirth;
    }

    // Configure document requirements based on verification type
    switch (verificationType) {
      case 'full':
        // Standard flow: Driver license + 2 POAs
        requestBody.documents = ['DRIVER_LICENSE'];
        requestBody.additionalSteps = {
          "ALL": {
            "ALL": ["UTILITY_BILL", "POA2"]
          }
        };
        break;
            
      case 'license':
      case 'license_only': 
        // Just license, no POAs
        requestBody.documents = ['DRIVER_LICENSE'];
        requestBody.additionalSteps = {
          "ALL": {
            "ALL": {}
          }
        };
        break;

      case 'poa1':
      case 'poa2':
        // Single POA update
        requestBody.documents = [];
        requestBody.additionalSteps = {
          'UTILITY_BILL': null
        };
        requestBody.utilityBillMinCount = 1;
        requestBody.skipFaceMatching = true;
        break;

      case 'poa_both':
        // Both POAs need updating
        requestBody.documents = [];
        requestBody.additionalSteps = {
          'UTILITY_BILL': null
        };
        requestBody.utilityBillMinCount = 2;
        requestBody.skipFaceMatching = true;
        break;

      case 'passport_only':
        // Passport for non-UK drivers
        requestBody.documents = ['PASSPORT'];
        requestBody.additionalSteps = {
          "ALL": {
            "ALL": {}
          }
        };
        
        // Fetch COMPARE data for passport validation
        if (email && verificationType === 'passport_only') {
          try {
            const statusResponse = await fetch(
              `${process.env.URL}/.netlify/functions/driver-status?email=${encodeURIComponent(email)}`
            );
            
            if (statusResponse.ok) {
              const driverData = await statusResponse.json();
              
              if (driverData.firstName && driverData.lastName) {
                requestBody.firstName = driverData.firstName;
                requestBody.lastName = driverData.lastName;
                console.log('✅ COMPARE data loaded for passport validation');
              }
              
              if (driverData.dateOfBirth) {
                requestBody.dateOfBirth = driverData.dateOfBirth;
              }
            }
          } catch (error) {
            console.log('⚠️ Could not fetch driver data for COMPARE:', error.message);
          }
        }
        
        requestBody.skipFaceMatching = true;
        break;
      
      default:
        // Default to full verification
        requestBody.documents = ['DRIVER_LICENSE'];
        requestBody.additionalSteps = {
          "ALL": {
            "ALL": ["UTILITY_BILL", "POA2"]
          }
        };
    }

    console.log('📋 Idenfy request for:', verificationType);
     
    // Call Idenfy API
    const response = await fetch(`${IDENFY_BASE_URL}/api/v2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    // Handle Idenfy API response
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Idenfy API error:', response.status, errorText);
      throw new Error(`Idenfy API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // Validate response has required fields
    if (!result.authToken || !result.scanRef) {
      throw new Error('Invalid Idenfy response: missing authToken or scanRef');
    }

    console.log('✅ Idenfy session created:', result.scanRef);

    return {
      success: true,
      sessionToken: result.authToken,
      scanRef: result.scanRef,
      clientId: clientId,
      redirectUrl: `https://ui.idenfy.com/session?authToken=${result.authToken}`,
      documentsRequired: requestBody.documents
    };

  } catch (error) {
    console.error('❌ Idenfy API error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update driver verification status in Google Sheets
 * @param {string} email - Driver email
 * @param {string} jobId - Job ID
 * @param {Object} updates - Status updates
 */
async function updateDriverVerificationStatus(email, jobId, updates) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('⚠️ Google Apps Script URL not configured - skipping status update');
      return;
    }

    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'update-driver-verification',
        email: email,
        jobId: jobId,
        updates: updates
      })
    });

    if (response.ok) {
      console.log('✅ Driver verification status updated');
    } else {
      console.error('⚠️ Failed to update driver verification status');
    }

  } catch (error) {
    console.error('❌ Error updating driver verification status:', error.message);
  }
}
