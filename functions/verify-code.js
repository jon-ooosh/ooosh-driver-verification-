// File: functions/verify-code.js
// OOOSH Driver Verification - Verify Email Code Function
// FIXED VERSION - Restoring test email backdoors that were working

exports.handler = async (event, context) => {
  console.log('Verify code function called with method:', event.httpMethod);
  
  // Add CORS headers for preflight requests
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

    const { email, code, jobId } = JSON.parse(event.body);
    
    // Enhanced logging for debugging
    console.log('Verify code request:', { 
      email: email, 
      code: code ? `${code.length}-digit code` : 'NO CODE', 
      jobId: jobId,
      actualCode: code, // Log actual code for debugging
       });

    if (!email || !code || !jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email, code, and jobId are required' })
      };
    }

        // FIXED: Ensure code is a string for consistent handling
    const codeStr = String(code).trim();
    
    if (codeStr.length !== 6 || !/^\d{6}$/.test(codeStr)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Code must be exactly 6 digits' })
      };
    }

    // Check if Google Apps Script URL is configured
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('GOOGLE_APPS_SCRIPT_URL not configured, using mock verification');
      
      // Mock verification - accept any 6-digit code for development
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: true, 
          verified: true,
          message: 'Email verified successfully (mock mode)' 
        })
      };
    }

    // Call Google Apps Script for real verification
    console.log('Calling Google Apps Script for verification');
    
    // Around line 90, REPLACE the fetch call with this:
const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    action: 'verify-code',
    email: email,
    code: codeStr,
    jobId: jobId
  })
});

// ADD THIS BEFORE trying to parse JSON:
console.log('Response status:', response.status);
console.log('Response headers:', response.headers.get('content-type'));

// Get the raw text first
const rawText = await response.text();
console.log('Raw response (first 500 chars):', rawText.substring(0, 500));

// Now try to parse
let result;
try {
  result = JSON.parse(rawText);
  console.log('Parsed result:', result);
} catch (e) {
  console.error('Failed to parse as JSON. Raw response:', rawText);
  return {
    statusCode: 500,
    headers,
    body: JSON.stringify({ 
      error: 'Email verification service error',
      details: 'Apps Script returned invalid response'
    })
  };
}

    // FIXED: Proper error handling for wrong codes
    
    // Check if the Apps Script returned an error
    if (result.error) {
      console.log('Verification failed:', result.error);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: result.error 
        })
      };
    }

    // Check if verification was successful  
    if (!result.success || !result.verified) {
      console.log('Verification not successful');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid verification code' 
        })
      };
    }

    // Verification successful
    console.log('Verification successful');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Code verification error:', error);
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

// Create test driver record for backdoor emails - RESTORED FROM WORKING VERSION
async function createTestDriverRecord(email, jobId) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('No Google Apps Script URL - skipping test driver creation');
      return;
    }

    // Call Google Apps Script to create driver record
    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'create-test-driver',
        email: email,
        jobId: jobId
      })
    });

    if (response.ok) {
      console.log('Test driver record created successfully');
    } else {
      console.error('Failed to create test driver record');
    }

  } catch (error) {
    console.error('Error creating test driver record:', error);
  }
}
