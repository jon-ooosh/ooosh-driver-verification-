// File: functions/save-insurance-data.js
// OOOSH Driver Verification - Save Insurance Data Function

exports.handler = async (event, context) => {
  console.log('Save insurance data function called with method:', event.httpMethod);
  
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

    const { email, jobId, insuranceData } = JSON.parse(event.body);
    console.log('Saving insurance data for:', { email, jobId });

    if (!email || !jobId || !insuranceData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email, jobId, and insuranceData are required' })
      };
    }

    // Check if Google Apps Script URL is configured
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('GOOGLE_APPS_SCRIPT_URL not configured, using mock response');
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: true, 
          message: 'Insurance data saved (mock mode)',
          mockMode: true
        })
      };
    }

    // Call Google Apps Script
    console.log('Calling Google Apps Script to save insurance data');
    
    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'save-insurance-data',
        email: email,
        jobId: jobId,
        insuranceData: insuranceData
      })
    });

    const result = await response.json();
    console.log('Apps Script insurance save response:', result);

    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Save insurance data error:', error);
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
