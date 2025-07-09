// Netlify Function: Get Driver Status (Google Apps Script)

exports.handler = async (event, context) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const email = event.queryStringParameters?.email;

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email parameter is required' })
      };
    }

    // Call Google Apps Script
    const response = await fetch(`${process.env.GOOGLE_APPS_SCRIPT_URL}?action=get-driver-status&email=${encodeURIComponent(email)}`, {
      method: 'GET'
    });

    const result = await response.json();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Driver status error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
