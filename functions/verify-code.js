// File: functions/verify-code.js
// OOOSH Driver Verification - Verify Email Code Function
// PRODUCTION VERSION - All test backdoors removed

const fetch = require('node-fetch');

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
    console.log('Verify code request:', { email: email, jobId: jobId, codeLength: code ? code.length : 0 });

    if (!email || !code || !jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email, code, and jobId are required' })
      };
    }

    // Validate code format (must be 6 digits)
    if (!/^\d{6}$/.test(code)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid verification code format' 
        })
      };
    }

    // Check if Google Apps Script URL is configured
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.error('GOOGLE_APPS_SCRIPT_URL not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Email verification service not configured' 
        })
      };
    }

    // Call Google Apps Script for verification
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

    // Handle verification result
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

    // Verification successful - create Monday.com driver record
    console.log('Email verification successful, creating driver record');
    
    try {
      // Create driver in Monday.com
      const driverResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'create-driver',
          email: email,
          jobId: jobId
        })
      });

      if (driverResponse.ok) {
        const driverResult = await driverResponse.json();
        console.log('Driver record created in Monday.com:', driverResult.success);
      } else {
        console.error('Failed to create driver record in Monday.com');
        // Don't fail verification if Monday.com fails - user verified email successfully
      }
    } catch (mondayError) {
      console.error('Error creating Monday.com driver record:', mondayError);
      // Continue - email verification succeeded
    }

    // Return success
    console.log('Verification completed successfully');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        verified: true,
        message: 'Email verified successfully' 
      })
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
