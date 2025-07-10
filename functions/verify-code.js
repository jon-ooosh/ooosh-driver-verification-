// File: netlify/functions/verify-code.js
// OOOSH Driver Verification - Verify Email Code Function
// Replace your existing netlify/functions/verify-code.js with this content

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
    console.log('Verify code request:', { email, code, jobId });

    if (!email || !code || !jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email, code, and jobId are required' })
      };
    }

    // Check if Google Apps Script URL is configured
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('GOOGLE_APPS_SCRIPT_URL not configured, using mock verification');
      
      // Mock verification - accept any 6-digit code for development
      if (code.length === 6 && /^\d{6}$/.test(code)) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true, 
            verified: true,
            message: 'Email verified successfully (mock)' 
          })
        };
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Invalid verification code' 
          })
        };
      }
    }

    // Call Google Apps Script
    console.log('Calling Google Apps Script for verification');
    
    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'verify-code',
        email: email,
        code: code,
        jobId: jobId
      })
    });

    const result = await response.json();
    console.log('Apps Script verification response:', result);

    return {
      statusCode: response.status,
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
