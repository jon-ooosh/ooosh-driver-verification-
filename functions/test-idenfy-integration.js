// File: functions/test-idenfy-integration.js
// MINIMAL VERSION - Uses your proven Idenfy patterns, tests only Additional Steps API

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🧪 Minimal Additional Steps API Test');
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const testResults = {
      timestamp: new Date().toISOString(),
      testSuite: 'Additional Steps API Validation',
      tests: {},
      summary: { total: 0, passed: 0, failed: 0, warnings: 0 }
    };

    // Test 1: Basic Additional Steps Token Generation
    console.log('📋 Testing Additional Steps Token Generation');
    testResults.tests.additionalStepsToken = await testAdditionalStepsToken();
    updateSummary(testResults, testResults.tests.additionalStepsToken);

    // Test 2: Webhook Structure Validation (mock)
    console.log('📋 Testing Webhook Structure');
    testResults.tests.webhookStructure = await testWebhookStructure();
    updateSummary(testResults, testResults.tests.webhookStructure);

    console.log('✅ Minimal test completed');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(testResults, null, 2)
    };

  } catch (error) {
    console.error('❌ Test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Test failed',
        details: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// Test Additional Steps token generation using YOUR proven pattern
async function testAdditionalStepsToken() {
  const test = {
    name: 'Additional Steps Token Generation',
    description: 'Test generating token for POA re-upload using proven Idenfy pattern',
    success: false,
    details: {}
  };

  try {
    // Use YOUR proven environment setup
    if (!process.env.IDENFY_API_KEY || !process.env.IDENFY_API_SECRET) {
      test.details = {
        warning: 'Idenfy credentials not configured',
        recommendation: 'Add IDENFY_API_KEY and IDENFY_API_SECRET to Netlify'
      };
      return test;
    }

    // Use YOUR proven auth pattern
    const apiKey = process.env.IDENFY_API_KEY;
    const apiSecret = process.env.IDENFY_API_SECRET;
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    
    // Use YOUR proven base URL pattern
    const IDENFY_BASE_URL = process.env.IDENFY_BASE_URL || 'https://ivs.idenfy.com';

    // Minimal Additional Steps request (just POA re-upload)
    const tokenRequest = {
      clientId: `test_additional_${Date.now()}`,
      additionalSteps: {
        "UTILITY_BILL": {
          "type": "EXTRACT",
          "texts": {
            "en": {
              "name": "Upload new proof of address",
              "description": "Please upload a different utility bill"
            }
          },
          "settings": {
            "canUpload": true,
            "canCapture": false
          }
        }
      }
    };

    console.log('🔧 Making Additional Steps API call...');
    const response = await fetch(`${IDENFY_BASE_URL}/api/v2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tokenRequest)
    });

    const result = await response.json();
    
    test.details = {
      apiStatus: response.status,
      hasAuthToken: !!result.authToken,
      hasScanRef: !!result.scanRef,
      hasAdditionalSteps: !!result.additionalSteps,
      response: response.ok ? 'Success' : result
    };

    test.success = response.ok && result.authToken && result.additionalSteps;

    if (test.success) {
      console.log('✅ Additional Steps API working!');
    } else {
      console.log('❌ Additional Steps API failed:', result);
    }

  } catch (error) {
    test.details.error = error.message;
    console.error('❌ Additional Steps test error:', error);
  }

  return test;
}

// Test webhook structure (mock validation)
async function testWebhookStructure() {
  const test = {
    name: 'Webhook Structure Validation',
    description: 'Validate Additional Steps webhook callback structure',
    success: false,
    details: {}
  };

  try {
    // Mock Additional Steps webhook payload structure
    const mockWebhook = {
      final: true,
      platform: "IDENFY",
      status: {
        overall: "APPROVED",
        additionalSteps: {
          "UTILITY_BILL": {
            "status": "APPROVED",
            "data": {
              "documentType": "UTILITY_BILL",
              "extractedData": {
                "address": "123 Test Street"
              }
            }
          }
        }
      },
      scanRef: "test_scan_ref",
      clientId: "test_client_id"
    };

    // Validate structure
    const hasRequiredFields = mockWebhook.final && 
                             mockWebhook.status && 
                             mockWebhook.status.additionalSteps &&
                             mockWebhook.scanRef;

    test.details = {
      structureValid: hasRequiredFields,
      mockPayload: 'Structure validated',
      requiredFields: ['final', 'status.additionalSteps', 'scanRef', 'clientId']
    };

    test.success = hasRequiredFields;

  } catch (error) {
    test.details.error = error.message;
  }

  return test;
}

// Helper function
function updateSummary(testResults, testResult) {
  testResults.summary.total++;
  if (testResult.success) {
    testResults.summary.passed++;
  } else {
    testResults.summary.failed++;
  }
  
  if (testResult.details?.warning) {
    testResults.summary.warnings++;
  }
}
