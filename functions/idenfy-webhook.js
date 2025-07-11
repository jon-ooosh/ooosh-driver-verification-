// File: functions/idenfy-webhook.js
// OOOSH Driver Verification - Idenfy Webhook Handler
// Processes verification results from Idenfy

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Idenfy webhook called with method:', event.httpMethod);
  
  // Add CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Idenfy-Signature',
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
      console.log('No body received in webhook');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    console.log('Webhook body:', event.body);
    const webhookData = JSON.parse(event.body);
    console.log('Parsed webhook data:', JSON.stringify(webhookData, null, 2));

    // Extract key data from webhook
    const {
      clientId,
      scanRef,
      status,
      data,
      platform,
      final
    } = webhookData;

    if (!clientId || !scanRef || !status) {
      console.log('Missing required webhook data');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required webhook data' })
      };
    }

    // Only process final results
    if (!final) {
      console.log('Ignoring non-final webhook result');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Non-final result ignored' })
      };
    }

    console.log('Processing final Idenfy result:', {
      clientId,
      scanRef,
      overall: status.overall,
      autoDocument: status.autoDocument,
      autoFace: status.autoFace
    });

    // Extract client info from clientId
    const clientInfo = parseClientId(clientId);
    if (!clientInfo) {
      console.log('Could not parse client ID:', clientId);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid client ID format' })
      };
    }

    // Process the verification result
    const processResult = await processVerificationResult(
      clientInfo.email,
      clientInfo.jobId,
      scanRef,
      status,
      data
    );

    if (processResult.success) {
      console.log('Verification result processed successfully');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'Webhook processed successfully',
          scanRef: scanRef
        })
      };
    } else {
      console.error('Failed to process verification result:', processResult.error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to process verification result',
          details: processResult.error
        })
      };
    }

  } catch (error) {
    console.error('Webhook processing error:', error);
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

// Parse the client ID to extract email and job ID
function parseClientId(clientId) {
  try {
    // Format: ooosh_{jobId}_{email}_{timestamp}
    const parts = clientId.split('_');
    if (parts.length >= 4 && parts[0] === 'ooosh') {
      const jobId = parts[1];
      const emailParts = parts.slice(2, -1); // All parts except first and last
      const email = emailParts.join('_').replace('_at_', '@').replace('_dot_', '.');
      
      return { email, jobId };
    }
    return null;
  } catch (error) {
    console.error('Error parsing client ID:', error);
    return null;
  }
}

// Process the verification result and update database
async function processVerificationResult(email, jobId, scanRef, status, data) {
  try {
    console.log('Processing verification for:', { email, jobId, scanRef });

    // Determine verification outcome
    const verificationData = analyzeVerificationResult(status, data);
    console.log('Verification analysis:', verificationData);

    // Update Google Apps Script with results
    const updateResult = await updateVerificationInDatabase(
      email,
      jobId,
      scanRef,
      verificationData
    );

    return { success: true, data: verificationData };

  } catch (error) {
    console.error('Error processing verification result:', error);
    return { success: false, error: error.message };
  }
}

// Analyze Idenfy verification result
function analyzeVerificationResult(status, data) {
  const result = {
    overall: status.overall,
    scanRef: data?.scanRef || 'unknown',
    
    // Document analysis
    licenseValid: false,
    licenseExpiry: null,
    
    // Face verification
    faceValid: false,
    
    // Overall status
    approved: false,
    suspected: false,
    denied: false,
    
    // Additional data
    documentType: data?.docType || null,
    firstName: data?.docFirstName || null,
    lastName: data?.docLastName || null,
    dateOfBirth: data?.docDob || null,
    documentNumber: data?.docNumber || null,
    
    // Verification details
    autoDocument: status.autoDocument,
    autoFace: status.autoFace,
    manualDocument: status.manualDocument,
    manualFace: status.manualFace,
    
    // Issues
    mismatchTags: status.mismatchTags || [],
    fraudTags: status.fraudTags || [],
    suspicionReasons: status.suspicionReasons || []
  };

  // Determine overall approval status
  switch (status.overall) {
    case 'APPROVED':
      result.approved = true;
      result.licenseValid = (status.autoDocument === 'DOC_VALIDATED' || status.manualDocument === 'DOC_VALIDATED');
      result.faceValid = (status.autoFace === 'FACE_MATCH' || status.manualFace === 'FACE_MATCH');
      
      // Set license expiry if available
      if (data?.docExpiry) {
        result.licenseExpiry = data.docExpiry;
      }
      break;
      
    case 'SUSPECTED':
      result.suspected = true;
      // Might still be valid documents but flagged for manual review
      result.licenseValid = (status.autoDocument === 'DOC_VALIDATED');
      result.faceValid = (status.autoFace === 'FACE_MATCH');
      break;
      
    case 'DENIED':
      result.denied = true;
      result.licenseValid = false;
      result.faceValid = false;
      break;
      
    default:
      console.log('Unknown verification status:', status.overall);
      result.denied = true;
  }

  return result;
}

// Update verification results in Google Apps Script
async function updateVerificationInDatabase(email, jobId, scanRef, verificationData) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('Google Apps Script URL not configured');
      return { success: false, error: 'No database URL configured' };
    }

    const updatePayload = {
      action: 'update-idenfy-results',
      email: email,
      jobId: jobId,
      scanRef: scanRef,
      results: verificationData
    };

    console.log('Sending update to Google Apps Script:', updatePayload);

    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Database update successful:', result);
      return { success: true };
    } else {
      const errorText = await response.text();
      console.error('Database update failed:', response.status, errorText);
      return { success: false, error: `Database update failed: ${response.status}` };
    }

  } catch (error) {
    console.error('Error updating database:', error);
    return { success: false, error: error.message };
  }
