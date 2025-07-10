// File: netlify/functions/driver-status.js
// OOOSH Driver Verification - Get Driver Status Function
// Replace your existing netlify/functions/driver-status.js with this content

exports.handler = async (event, context) => {
  console.log('Driver status function called with method:', event.httpMethod);
  
  // Add CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const email = event.queryStringParameters?.email;
    console.log('Driver status request for email:', email);

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email parameter is required' })
      };
    }

    // Check if Google Apps Script URL is configured
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('GOOGLE_APPS_SCRIPT_URL not configured, returning mock driver status');
      
      // Return mock driver status for development
      const mockDriverStatus = {
        status: 'new',
        email: email,
        name: null,
        documents: {
          license: { valid: false },
          poa1: { valid: false },
          poa2: { valid: false },
          dvlaCheck: { valid: false }
        }
      };
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(mockDriverStatus)
      };
    }

    // Call Google Apps Script
    console.log('Calling Google Apps Script for driver status');
    
    const response = await fetch(`${process.env.GOOGLE_APPS_SCRIPT_URL}?action=get-driver-status&email=${encodeURIComponent(email)}`, {
      method: 'GET'
    });

    const result = await response.json();
    console.log('Apps Script driver status response:', result);

    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Driver status error:', error);
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
