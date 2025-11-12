// File: functions/send-verification-code.js
// OOOSH Driver Verification - Send Email Verification Code Function
// PRODUCTION VERSION - All test backdoors removed

exports.handler = async (event, context) => {
  console.log('Function called with method:', event.httpMethod);
  console.log('Headers:', event.headers);
  
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
    console.log('Request body:', event.body);
    
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    const { email, jobId } = JSON.parse(event.body);
    console.log('Parsed data:', { email, jobId });

    if (!email || !jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and jobId are required' })
      };
    }

    // Validate email format
    if (!email.includes('@')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email format' })
      };
    }

    // Check if Google Apps Script URL is configured
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.error('GOOGLE_APPS_SCRIPT_URL not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Email verification service not configured' 
        })
      };
    }

    // Call Google Apps Script to send verification email
    console.log('Calling Google Apps Script:', process.env.GOOGLE_APPS_SCRIPT_URL);
    
    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'send-verification-code',
        email: email,
        jobId: jobId
      })
    });

    console.log('Apps Script response status:', response.status);
    const result = await response.json();
    console.log('Apps Script response:', result);

    if (!response.ok) {
      throw new Error(result.error || `HTTP error! status: ${response.status}`);
    }

    // Check if email sending was successful
    if (!result.success) {
      throw new Error(result.error || 'Failed to send verification email');
    }

    console.log('Verification email sent successfully');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Email verification error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to send verification email',
        details: error.message
      })
    };
  }
};
