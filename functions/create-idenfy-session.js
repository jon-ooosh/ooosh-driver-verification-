// File: functions/create-idenfy-session.js
// ENHANCED VERSION - Supports selective document requirements

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
      verificationType = 'full', // full, license, poa1, poa2, poa_both, passport
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

    // Create Idenfy session with specific document requirements
    const idenfyResponse = await createIdenfySession(email, jobId, verificationType, isUKDriver);
    
    if (!idenfyResponse.success) {
      throw new Error(idenfyResponse.error || 'Failed to create Idenfy session');
    }

    // Store session info in Google Apps Script
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

// ENHANCED: Create Idenfy session with selective document requirements
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
      
      // Return URLs for different outcomes
      successUrl: `https://ooosh-driver-verification.netlify.app/?status=success&job=${jobId}&email=${encodeURIComponent(email)}&type=${verificationType}`,
      errorUrl: `https://ooosh-driver-verification.netlify.app/?status=error&job=${jobId}&email=${encodeURIComponent(email)}&type=${verificationType}`,
      unverifiedUrl: `https://ooosh-driver-verification.netlify.app/?status=unverified&job=${jobId}&email=${encodeURIComponent(email)}&type=${verificationType}`,
      
      locale: 'en',
      expiryTime: 3600,
      sessionLength: 1800,
      tokenType: 'IDENTIFICATION',
      showInstructions: true
    };

    // Configure documents based on verification type
    let documentsRequired = [];
    
    switch (verificationType) {
      case 'full':
        // Complete verification for new drivers or everything expired
        requestBody.documents = ['DRIVER_LICENSE'];
        // Idenfy will automatically request POAs with driver license
        requestBody.additionalSteps = ['PROOF_OF_ADDRESS'];
        requestBody.proofOfAddressCount = 2; // Request 2 POAs
        documentsRequired = ['Driving License (front & back)', 'Selfie', 'Proof of Address 1', 'Proof of Address 2'];
        if (!isUKDriver) {
          requestBody.documents.push('PASSPORT');
          documentsRequired.push('Passport');
        }
        break;

      case 'license':
        // License renewal only
        requestBody.documents = ['DRIVER_LICENSE'];
        requestBody.additionalSteps = []; // No POAs needed
        documentsRequired = ['Driving License (front & back)', 'Selfie'];
        break;

      case 'poa1':
        // Only POA1 expired
        requestBody.documents = [];
        requestBody.additionalSteps = ['PROOF_OF_ADDRESS'];
        requestBody.proofOfAddressCount = 1; // Only 1 POA needed
        requestBody.skipFaceMatching = true; // No selfie for POA only
        documentsRequired = ['Proof of Address 1'];
        break;

      case 'poa2':
        // Only POA2 expired
        requestBody.documents = [];
        requestBody.additionalSteps = ['PROOF_OF_ADDRESS'];
        requestBody.proofOfAddressCount = 1; // Only 1 POA needed
        requestBody.skipFaceMatching = true; // No selfie for POA only
        documentsRequired = ['Proof of Address 2'];
        break;

      case 'poa_both':
        // Both POAs expired
        requestBody.documents = [];
        requestBody.additionalSteps = ['PROOF_OF_ADDRESS'];
        requestBody.proofOfAddressCount = 2; // Both POAs needed
        requestBody.skipFaceMatching = true; // No selfie for POA only
        documentsRequired = ['Proof of Address 1', 'Proof of Address 2'];
        break;

      case 'passport':
        // Passport check for non-UK drivers
        requestBody.documents = ['PASSPORT'];
        requestBody.additionalSteps = [];
        requestBody.skipFaceMatching = true; // No selfie for passport only
        documentsRequired = ['Passport'];
        break;

      default:
        // Default to full verification if type unknown
        requestBody.documents = ['DRIVER_LICENSE'];
        requestBody.additionalSteps = ['PROOF_OF_ADDRESS'];
        requestBody.proofOfAddressCount = 2;
        documentsRequired = ['Driving License', 'Selfie', 'Proof of Address 1', 'Proof of Address 2'];
    }

    console.log(`Idenfy session config for ${verificationType}:`, {
      documents: requestBody.documents,
      additionalSteps: requestBody.additionalSteps,
      proofOfAddressCount: requestBody.proofOfAddressCount,
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

// Update driver verification status in Google Apps Script (keeping your existing function)
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
