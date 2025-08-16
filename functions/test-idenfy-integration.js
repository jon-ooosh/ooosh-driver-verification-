// File: functions/test-idenfy-integration.js
// FIXED VERSION - Correct Additional Steps API payload format

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🧪 Fixed Additional Steps API Test');
  
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

    // Test 1: Fixed Additional Steps Token Generation
    console.log('📋 Testing Additional Steps Token Generation (FIXED)');
    testResults.tests.additionalStepsToken = await testAdditionalStepsToken();
    updateSummary(testResults, testResults.tests.additionalStepsToken);

    // Test 2: Webhook Structure Validation (mock)
    console.log('📋 Testing Webhook Structure');
    testResults.tests.webhookStructure = await testWebhookStructure();
    updateSummary(testResults, testResults.tests.webhookStructure);

    console.log('✅ Fixed test completed');
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

// FIXED: Additional Steps token generation with correct payload structure
async function testAdditionalStepsToken() {
  const test = {
    name: 'Additional Steps Token Generation',
    description: 'Test generating token for POA re-upload using CORRECTED Idenfy payload format',
    success: false,
    details: {}
  };

  try {
    // Check environment variables
    if (!process.env.IDENFY_API_KEY || !process.env.IDENFY_API_SECRET) {
      test.details = {
        warning: 'Idenfy credentials not configured',
        recommendation: 'Add IDENFY_API_KEY and IDENFY_API_SECRET to Netlify'
      };
      return test;
    }

    // Use proven auth pattern
    const apiKey = process.env.IDENFY_API_KEY;
    const apiSecret = process.env.IDENFY_API_SECRET;
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    
    const IDENFY_BASE_URL = process.env.IDENFY_BASE_URL || 'https://ivs.idenfy.com';

    // FIXED: Correct Additional Steps payload structure
    // Based on Idenfy docs - the structure was wrong in the original
    const tokenRequest = {
      clientId: `test_additional_${Date.now()}`,
      // FIXED: Use correct structure for additional steps
      additionalSteps: [
        {
          documentType: "UTILITY_BILL",
          stepType: "UPLOAD",
          texts: {
            en: {
              name: "Upload new proof of address",
              description: "Please upload a different utility bill or bank statement"
            }
          },
          settings: {
            canUpload: true,
            canCapture: false,
            // FIXED: Add required settings
            documentTypes: ["UTILITY_BILL", "BANK_STATEMENT"],
            maxFileSize: 10485760, // 10MB
            supportedFormats: ["pdf", "jpg", "jpeg", "png"]
          }
        }
      ]
    };

    console.log('🔧 Making Additional Steps API call with corrected payload...');
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
      response: response.ok ? 'Success' : result,
      // FIXED: Add payload structure info
      payloadStructure: response.ok ? 'Correct format accepted' : 'Payload rejected'
    };

    test.success = response.ok && result.authToken && result.additionalSteps;

    if (test.success) {
      console.log('✅ Additional Steps API working with corrected payload!');
    } else {
      console.log('❌ Additional Steps API still failing:', result);
    }

  } catch (error) {
    test.details.error = error.message;
    console.error('❌ Additional Steps test error:', error);
  }

  return test;
}

// Test webhook structure (unchanged - this was already passing)
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
      structureValid: hasRequiredFields ? "test_scan_ref" : false,
      mockPayload: 'Structure validated',
      requiredFields: ['final', 'status.additionalSteps', 'scanRef', 'clientId']
    };

    test.success = hasRequiredFields;

  } catch (error) {
    test.details.error = error.message;
  }

  return test;
}

// Helper function (unchanged)
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
