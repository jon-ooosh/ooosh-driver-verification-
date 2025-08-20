// File: functions/create-idenfy-session.js
// CORRECTED VERSION - Proper Idenfy API format based on documentation

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
      
      const mockResponse = {
        success: true,
        sessionToken: `mock_${verificationType}_${Date.now()}`,
        scanRef: 'MOCK_' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        clientId: email.replace('@', '_at_').replace('.', '_dot_'),
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

// CORRECTED: Proper Idenfy API format based on documentation
async function createIdenfySession(email, jobId, verificationType, isUKDriver) {
  try {
    const apiKey = process.env.IDENFY_API_KEY;
    const apiSecret = process.env.IDENFY_API_SECRET;
    
    const IDENFY_BASE_URL = 'https://ivs.idenfy.com';
    const clientId = `ooosh_${jobId}_${verificationType}_${Date.now()}`;
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    // Base configuration
    const requestBody = {
      clientId: clientId,
      
      // Return URLs
      successUrl: `https://ooosh-driver-verification.netlify.app/?status=success&job=${jobId}&email=${encodeURIComponent(email)}&type=${verificationType}`,
      errorUrl: `https://ooosh-driver-verification.netlify.app/?status=error&job=${jobId}&email=${encodeURIComponent(email)}&type=${verificationType}`,
      unverifiedUrl: `https://ooosh-driver-verification.netlify.app/?status=unverified&job=${jobId}&email=${encodeURIComponent(email)}&type=${verificationType}`,
      
      locale: 'en',
      expiryTime: 3600,
      sessionLength: 1800,
      showInstructions: true
    };

    // Configure documents based on verification type
    let documentsRequired = [];
    
    switch (verificationType) {
      case 'full':
        // Complete verification for new drivers
        requestBody.documents = ['DRIVER_LICENSE'];
        // CORRECTED: additionalSteps as object with UTILITY_BILL
        requestBody.additionalSteps = {
          'UTILITY_BILL': {
            utilityBillMinCount: 2  // Request 2 POAs
          }
        };
        documentsRequired = ['Driving License (front & back)', 'Selfie', 'Proof of Address 1', 'Proof of Address 2'];
        break;

      case 'license':
        // License renewal only (no POAs)
        requestBody.documents = ['DRIVER_LICENSE'];
        // No additional steps - just license
        documentsRequired = ['Driving License (front & back)', 'Selfie'];
        break;

      case 'poa1':
      case 'poa2':
        // Single POA update - can't differentiate between POA1 and POA2
        requestBody.documents = [];
        requestBody.additionalSteps = {
          'UTILITY_BILL': {
            utilityBillMinCount: 1  // Just 1 POA
          }
        };
        requestBody.skipFaceMatching = true; // No selfie for POA only
        documentsRequired = ['Proof of Address'];
        break;

      case 'poa_both':
        // Both POAs expired
        requestBody.documents = [];
        requestBody.additionalSteps = {
          'UTILITY_BILL': {
            utilityBillMinCount: 2  // Both POAs
          }
        };
        requestBody.skipFaceMatching = true; // No selfie for POA only
        documentsRequired = ['Proof of Address 1', 'Proof of Address 2'];
        break;

      case 'passport':
        // Passport check for non-UK drivers
        requestBody.documents = ['PASSPORT'];
        requestBody.skipFaceMatching = true; // No selfie if already verified
        documentsRequired = ['Passport'];
        break;

      default:
        // Default to full verification
        requestBody.documents = ['DRIVER_LICENSE'];
        requestBody.additionalSteps = {
          'UTILITY_BILL': {
            utilityBillMinCount: 2
          }
        };
        documentsRequired = ['Driving License', 'Selfie', 'Proof of Address 1', 'Proof of Address 2'];
    }

    // Add document selection settings if needed
    if (verificationType === 'full' && !isUKDriver) {
      // For non-UK drivers, allow passport selection
      requestBody.showDocumentSelection = true;
      requestBody.documents = ['DRIVER_LICENSE', 'PASSPORT'];
      documentsRequired.push('Passport (for non-UK drivers)');
    }

    console.log(`Idenfy session config for ${verificationType}:`, {
      documents: requestBody.documents,
      additionalSteps: requestBody.additionalSteps,
      skipFaceMatching: requestBody.skipFaceMatching
    });

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
      clientId: clientId,
      redirectUrl: `https://ui.idenfy.com/session?authToken=${result.authToken}`,
      documentsRequired: documentsRequired
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
      console.log('Driver verification status updated in Google Sheets');
    } else {
      console.error('Failed to update driver verification status');
    }

  } catch (error) {
    console.error('Error updating driver verification status:', error);
  }
}
