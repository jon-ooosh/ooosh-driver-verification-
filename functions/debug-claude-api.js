// File: functions/debug-claude-api.js
// Quick API connection test - add this temporarily to debug

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Debug Claude API connection test');
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Check if API key exists
    if (!process.env.CLAUDE_API_KEY) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          error: 'No Claude API key found',
          envVars: Object.keys(process.env).filter(key => key.includes('CLAUDE'))
        })
      };
    }

    console.log('API key found, testing simple text request...');

    // Simple text-only test (no images/PDFs)
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: 'Hello! Please respond with a simple JSON object: {"test": "success", "message": "API working"}'
        }]
      })
    });

    console.log('Claude API response status:', claudeResponse.status);
    
    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('Claude API error:', errorText);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          error: `Claude API error (${claudeResponse.status})`,
          details: errorText,
          timestamp: new Date().toISOString()
        })
      };
    }

    const result = await claudeResponse.json();
    console.log('Claude API success:', result);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        claudeResponse: result,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Debug error:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        error: 'Debug test failed',
        details: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      })
    };
  }
};
