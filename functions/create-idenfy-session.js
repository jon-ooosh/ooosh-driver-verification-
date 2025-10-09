// File: functions/create-idenfy-session.js
// FIXED VERSION - Client ID includes email for proper webhook processing

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Create Idenfy session called with method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

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
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    const { 
      email, 
      jobId, 
      driverName,
      verificationType = 'full', // full, license, poa1, poa2, poa_both, passport, none
      isUKDriver = true 
    } = JSON.parse(event.body);
    
    console.log('Creating Idenfy session for:', { email, jobId, verificationType, isUKDriver });

    if (!email || !jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and jobId are required' })
      };
    }

    // Check if Idenfy credentials are configured
    if (!process.env.IDENFY_API_KEY || !process.env.IDENFY_API_SECRET) {
      console.log('Idenfy credentials not configured, using mock response');
      
      // FIXED: Include proper client ID with email
      const encodedEmail = email.replace('@', '_at_').replace(/\./g, '_dot_');
      const mockResponse = {
        success: true,
        sessionToken: `mock_${verificationType}_${Date.now()}`,
        scanRef: 'MOCK_' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        clientId: `ooosh_${jobId}_${encodedEmail}_${Date.now()}`,
        redirectUrl: `https://ooosh-driver-verification.netlify.app/?status=mock&job=${jobId}&email=${encodeURIComponent(email)}&type=${verificationType}`,
        verificationType: verificationType,
        message: 'Mock Idenfy session created for development'
      };
      
      return { statusCode: 200, headers, body: JSON.stringify(mockResponse) };
    }

    // For everything valid, skip Idenfy and go to signature
    if (verificationType === 'none') {
      console.log('All documents valid, skipping Idenfy');
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

    // Create Idenfy session with specific document requirements
    const idenfyResponse = await createIdenfySession(email, jobId, verificationType, isUKDriver);
    
    if (!idenfyResponse.success) {
      throw new Error(idenfyResponse.error || 'Failed to create Idenfy session');
    }

    // Store session info (keeping your existing function)
    await updateDriverVerificationStatus(email, jobId, {
      idenfySessionId: idenfyResponse.scanRef,
      idenfyStatus: 'initiated',
      verificationType: verificationType,
      status: 'document_upload_started'
    });

    console.log('Idenfy session created successfully:', idenfyResponse.scanRef);

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
    console.error('Create Idenfy session error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};

// FIXED: Include email in client ID for webhook processing
async function createIdenfySession(email, jobId, verificationType, isUKDriver) {
  try {
    const apiKey = process.env.IDENFY_API_KEY;
    const apiSecret = process.env.IDENFY_API_SECRET;
    
    const IDENFY_BASE_URL = 'https://ivs.idenfy.com';
    
    // CRITICAL FIX: Include email in client ID so webhook can parse it
    const encodedEmail = email.replace('@', '_at_').replace(/\./g, '_dot_');
    const clientId = `ooosh_${jobId}_${encodedEmail}_${Date.now()}`;
    
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    console.log('🔑 Creating Idenfy session with client ID:', clientId);

    // Fetch existing driver data for COMPARE validation (revalidations only)
    let firstName = null;
    let lastName = null;
    let dateOfBirth = null;
    
    if (verificationType !== 'full') {  // Only for revalidations, not new drivers
      try {
        console.log('🔍 Fetching driver data for COMPARE validation...');
        const driverResponse = await fetch(`${process.env.URL}/.netlify/functions/driver-status?email=${encodeURIComponent(email)}`);
        
        if (driverResponse.ok) {
          const driverData = await driverResponse.json();
          
          // Use stored firstName/lastName directly - no parsing needed!
          firstName = driverData.firstName;
          lastName = driverData.lastName;
          dateOfBirth = driverData.dateOfBirth;
          
          if (firstName && lastName) {
            console.log('✅ COMPARE data loaded:', { firstName, lastName, dateOfBirth });
          } else {
            console.log('⚠️ No firstName/lastName in driver record - COMPARE skipped');
          }
        }
      } catch (error) {
        console.log('⚠️ Could not fetch driver data (continuing anyway):', error.message);
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

    
    // Configure based on verification type
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
  // JUST license, no POAs
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
        requestBody.documents = []; // Empty array for no primary document
       requestBody.additionalSteps = {
    'UTILITY_BILL': null  // Object format, not array!
  };
        requestBody.utilityBillMinCount = 1; // Just 1 POA
        requestBody.skipFaceMatching = true; // No selfie
        break;

      case 'poa_both':
  // POA-only re-upload using Additional Steps
  requestBody.documents = []; // No primary documents
  requestBody.additionalSteps = {
    'UTILITY_BILL': null  // Object format, not array!
  };
  requestBody.utilityBillMinCount = 2; // Need 2 POAs
  break;

      case 'passport_only':
  // Passport for non-UK drivers - use COMPARE validation
  requestBody.documents = ['PASSPORT'];
  
  // CRITICAL: Same as license_only - explicitly disable POAs
  requestBody.additionalSteps = {
    "ALL": {
      "ALL": {}
    }
  };
  
  // Add COMPARE data to validate passport matches license records
  if (email) {
    try {
      console.log('🔍 Fetching driver data for COMPARE validation...');
      const statusResponse = await fetch(`${process.env.URL}/.netlify/functions/driver-status?email=${encodeURIComponent(email)}`);
      
      if (statusResponse.ok) {
        const driverData = await statusResponse.json();
        
        // Use stored firstName/lastName for COMPARE validation
        if (driverData.firstName && driverData.lastName) {
          requestBody.firstName = driverData.firstName;
          requestBody.lastName = driverData.lastName;
          console.log('✅ COMPARE data loaded for passport validation:', {
            firstName: driverData.firstName,
            lastName: driverData.lastName
          });
        } else {
          console.log('⚠️ No firstName/lastName in driver record - COMPARE skipped');
        }
        
        // Also add DOB if available for extra validation
        if (driverData.dateOfBirth) {
          requestBody.dateOfBirth = driverData.dateOfBirth;
          console.log('✅ DOB added for COMPARE validation');
        }
      }
    } catch (error) {
      console.log('⚠️ Could not fetch driver data for COMPARE:', error.message);
    }
  }
  
  // Skip face matching since we're not reusing face data
  requestBody.skipFaceMatching = true;
  console.log('📸 Face matching disabled for passport-only verification');
  break;
      
      default:
        // Default to full verification
        requestBody.documents = ['DRIVER_LICENSE'];
    }

    console.log(`📋 Full Idenfy request body for ${verificationType}:`, JSON.stringify(requestBody, null, 2));
     
    const response = await fetch(`${IDENFY_BASE_URL}/api/v2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();
    console.log('Idenfy API response status:', response.status);

    if (!response.ok) {
      console.error('Idenfy API error:', result);
      throw new Error(`Idenfy API error (${response.status}): ${result.message || result.error || response.statusText}`);
    }

    if (!result.authToken || !result.scanRef) {
      throw new Error(`Invalid Idenfy response: missing authToken or scanRef`);
    }

    return {
      success: true,
      sessionToken: result.authToken,
      scanRef: result.scanRef,
      clientId: clientId,  // This now includes the email!
      redirectUrl: `https://ui.idenfy.com/session?authToken=${result.authToken}`,
      documentsRequired: requestBody.documents
    };

  } catch (error) {
    console.error('Idenfy API error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Keep your existing updateDriverVerificationStatus function unchanged
async function updateDriverVerificationStatus(email, jobId, updates) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('Google Apps Script URL not configured');
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
      console.log('Driver verification status logged');
    } else {
      console.error('Failed to update driver verification status');
    }

  } catch (error) {
    console.error('Error updating driver verification status:', error);
  }
}
