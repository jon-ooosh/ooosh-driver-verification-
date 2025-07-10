// File: functions/send-verification-code.js
// OOOSH Driver Verification - Send Email Verification Code Function
// Replace your existing functions/send-verification-code.js with this content
 
const fetch = require('node-fetch');

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

    // Check if Google Apps Script URL is configured
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('GOOGLE_APPS_SCRIPT_URL not configured, using mock response');
      
      // Return mock response for development
      const debugCode = Math.floor(100000 + Math.random() * 900000).toString();
      console.log('DEBUG: Generated verification code:', debugCode);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: true, 
          message: 'Verification code sent',
          debugCode: debugCode // For development only
        })
      };
    }

    // Call Google Apps Script
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

    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Email verification error:', error);
    
    // Return detailed error for debugging
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
