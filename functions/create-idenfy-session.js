// File: functions/create-idenfy-session.js
// OOOSH Driver Verification - Create Idenfy Verification Session
// FIXED VERSION - Correct API parameters based on official documentation

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Create Idenfy session called with method:', event.httpMethod);
  
  // Add CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST requests
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
      
      // Return mock response for development
      const mockResponse = {
        success: true,
        sessionToken: 'mock_session_' + Date.now(),
        scanRef: 'MOCK_' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        clientId: email.replace('@', '_at_').replace('.', '_dot_'),
        redirectUrl: `https://ooosh-driver-verification.netlify.app/verification-complete?status=mock&session=mock_session_${Date.now()}`,
        message: 'Mock Idenfy session created for development'
      };
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(mockResponse)
      };
    }

    // Create Idenfy verification session
    console.log('Calling Idenfy API to create session');
    
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

// Create Idenfy verification session using their API - FIXED VERSION
async function createIdenfySession(email, jobId, driverName) {
  try {
    const apiKey = process.env.IDENFY_API_KEY;
    const apiSecret = process.env.IDENFY_API_SECRET;
    
    // Official Idenfy API endpoint
    const IDENFY_BASE_URL = 'https://ivs.idenfy.com';

    // Generate unique client ID
    const clientId = `ooosh_${jobId}_${email.replace('@', '_').replace('.', '_')}_${Date.now()}`;
    
    // Create authentication header
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    // FIXED: Correct request body according to Idenfy documentation
    const requestBody = {
      clientId: clientId,
      firstName: driverName?.split(' ')[0] || 'Driver',
      lastName: driverName?.split(' ').slice(1).join(' ') || 'Verification',
      
      // Redirect URLs for different outcomes
      successUrl: `https://ooosh-driver-verification.netlify.app/verification-complete?status=success&job=${jobId}`,
      errorUrl: `https://ooosh-driver-verification.netlify.app/verification-complete?status=error&job=${jobId}`,
      unverifiedUrl: `https://ooosh-driver-verification.netlify.app/verification-complete?status=unverified&job=${jobId}`,
      
      // Basic settings
      locale: 'en',
      
      // FIXED: Remove documents array to allow all UK document types
      // This allows: ID_CARD, PASSPORT, DRIVER_LICENSE, RESIDENCE_PERMIT
      // Don't restrict - let users upload what they have
      
      // FIXED: Remove additionalSteps - this parameter doesn't exist
      // Face matching is included by default in IDENTIFICATION token type
      
      // Session management
      expiryTime: 3600, // 1 hour to complete verification
      sessionLength: 1800, // 30 minutes per verification session
      
      // Token type - IDENTIFICATION includes document + selfie verification
      tokenType: 'IDENTIFICATION',
      
      // Webhook for receiving results
      callbackUrl: `https://ooosh-driver-verification.netlify.app/.netlify/functions/idenfy-webhook`,
      
      // Optional: Additional settings for better verification
      showInstructions: true
    };

    console.log('Sending corrected request to Idenfy:', JSON.stringify(requestBody, null, 2));

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
      throw new Error(`Idenfy API error (${response.status}): ${result.message || result.error || response.statusText}`);
    }

    // Check if we got the expected response format
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
