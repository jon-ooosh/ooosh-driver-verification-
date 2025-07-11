// File: functions/create-idenfy-session.js
// FIXED VERSION - Based on learnings from JotForm integration

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

    const { email, jobId, driverName } = JSON.parse(event.body);
    console.log('Creating Idenfy session for:', { email, jobId, driverName });

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
        sessionToken: 'mock_session_' + Date.now(),
        scanRef: 'MOCK_' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        clientId: email.replace('@', '_at_').replace('.', '_dot_'),
        redirectUrl: `https://ooosh-driver-verification.netlify.app/verification-complete?status=mock&session=mock_session_${Date.now()}`,
        message: 'Mock Idenfy session created for development'
      };
      
      return { statusCode: 200, headers, body: JSON.stringify(mockResponse) };
    }

    // FIXED: Create Idenfy session with correct parameters
    const idenfyResponse = await createIdenfySession(email, jobId, driverName);
    
    if (!idenfyResponse.success) {
      throw new Error(idenfyResponse.error || 'Failed to create Idenfy session');
    }

    // Store session info in Google Apps Script
    await updateDriverVerificationStatus(email, jobId, {
      idenfySessionId: idenfyResponse.scanRef,
      idenfyStatus: 'initiated',
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

// FIXED: Create Idenfy session with proper country handling and document selection
async function createIdenfySession(email, jobId, driverName) {
  try {
    const apiKey = process.env.IDENFY_API_KEY;
    const apiSecret = process.env.IDENFY_API_SECRET;
    
    const IDENFY_BASE_URL = 'https://ivs.idenfy.com';
    const clientId = `ooosh_${jobId}_${email.replace('@', '_').replace('.', '_')}_${Date.now()}`;
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    // FIXED: Use proper parameters based on JotForm learnings
    const requestBody = {
      clientId: clientId,
      firstName: driverName?.split(' ')[0] || 'Driver',
      lastName: driverName?.split(' ').slice(1).join(' ') || 'Verification',
      
      // FIXED: Use your domain for callbacks
      successUrl: `https://ooosh-driver-verification.netlify.app/?status=success&job=${jobId}&email=${encodeURIComponent(email)}`,
      errorUrl: `https://ooosh-driver-verification.netlify.app/?status=error&job=${jobId}&email=${encodeURIComponent(email)}`,
      unverifiedUrl: `https://ooosh-driver-verification.netlify.app/?status=unverified&job=${jobId}&email=${encodeURIComponent(email)}`,
      
      // FIXED: Add webhook URL for result processing
      callbackUrl: `https://ooosh-driver-verification.netlify.app/.netlify/functions/idenfy-webhook`,
      
      locale: 'en',
      
      // FIXED: Set UK as default country (from JotForm script)
      country: 'GB',
      
      // FIXED: Specify required documents (driving license + POA)
      documents: ['DRIVER_LICENSE'],
      
      // FIXED: Add POA extraction (from JotForm script)
      additionalSteps: {
        UTILITY_BILL: 'EXTRACT',
        POA2: 'EXTRACT'
      },
      
      // Session settings
      expiryTime: 3600,
      sessionLength: 1800,
      tokenType: 'IDENTIFICATION',
      showInstructions: true,
      
      // FIXED: Add signature extraction
      extractSignature: true
    };

    console.log('FIXED: Sending request to Idenfy with proper parameters:', JSON.stringify(requestBody, null, 2));

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
    console.log('Idenfy API response:', JSON.stringify(result, null, 2));

    if (!response.ok) {
      // FIXED: Better error handling for country issues
      if (result.message && result.message.includes('country')) {
        console.log('Country error detected, retrying with null country...');
        
        // Retry without country specification
        const retryBody = { ...requestBody, country: null };
        const retryResponse = await fetch(`${IDENFY_BASE_URL}/api/v2/token`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(retryBody)
        });

        if (retryResponse.ok) {
          const retryResult = await retryResponse.json();
          return {
            success: true,
            sessionToken: retryResult.authToken,
            scanRef: retryResult.scanRef,
            clientId: clientId,
            redirectUrl: `https://ui.idenfy.com/session?authToken=${retryResult.authToken}`
          };
        }
      }
      
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
      redirectUrl: `https://ui.idenfy.com/session?authToken=${result.authToken}`
    };

  } catch (error) {
    console.error('Idenfy API error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Update driver verification status in Google Apps Script
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
