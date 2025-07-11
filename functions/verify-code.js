// File: functions/verify-code.js
// OOOSH Driver Verification - Verify Email Code Function
// FIXED VERSION with TESTING BACKDOOR for development

const fetch = require('node-fetch');

// 🚨 TESTING BACKDOOR - REMOVE BEFORE PRODUCTION! 🚨
const TEST_EMAILS = [
  'test@oooshtours.co.uk',
  'jon@oooshtours.co.uk', // For easy testing
  'demo@oooshtours.co.uk',
  'dev@oooshtours.co.uk'
];

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

    // 🚨 TESTING BACKDOOR - Auto-verify test emails 🚨
    if (TEST_EMAILS.includes(email.toLowerCase())) {
      console.log('🚨 TESTING BACKDOOR: Auto-verifying test email:', email);
      console.log('🚨 ANY CODE ACCEPTED FOR TEST EMAILS - REMOVE IN PRODUCTION!');
      
      // Create driver record for test email
      await createTestDriverRecord(email, jobId);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: true, 
          verified: true,
          message: 'Email verified successfully (TEST MODE)',
          testMode: true
        })
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

    // Call Google Apps Script for real verification
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

    // *** CRITICAL FIX: Proper error handling for wrong codes ***
    
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

// Create test driver record for backdoor emails
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
