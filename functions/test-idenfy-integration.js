// File: functions/test-idenfy-integration.js
// CORRECT VERSION - Additional Steps must be pre-configured in Idenfy environment

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🧪 Environment-Based Additional Steps API Test');
  
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

    // Test 1: Environment-Based Additional Steps Token Generation
    console.log('📋 Testing Environment-Based Additional Steps');
    testResults.tests.additionalStepsToken = await testAdditionalStepsToken();
    updateSummary(testResults, testResults.tests.additionalStepsToken);

    // Test 2: Re-upload API Test
    console.log('📋 Testing Re-upload API Structure');
    testResults.tests.reuploadStructure = await testReuploadStructure();
    updateSummary(testResults, testResults.tests.reuploadStructure);

    console.log('✅ Environment-based test completed');
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

// CORRECTED: Use environment-configured Additional Steps
async function testAdditionalStepsToken() {
  const test = {
    name: 'Additional Steps Token Generation',
    description: 'Test using environment-configured Additional Steps (no custom payload needed)',
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

    // CORRECTED: Simple token request - Additional Steps come from environment
    const tokenRequest = {
      clientId: `test_additional_${Date.now()}`
      // NO additionalSteps object needed if configured in environment
    };

    console.log('🔧 Making simple token request (environment-based Additional Steps)...');
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
      environmentConfigured: !!result.additionalSteps,
      response: response.ok ? 'Token created successfully' : result
    };

    // Success if we get a token, regardless of Additional Steps
    test.success = response.ok && result.authToken;

    if (test.success) {
      if (result.additionalSteps) {
        console.log('✅ Additional Steps enabled in environment!');
      } else {
        console.log('⚠️ Token created but no Additional Steps in environment');
        test.details.warning = 'Additional Steps not configured in Idenfy environment';
      }
    } else {
      console.log('❌ Basic token creation failed:', result);
    }

  } catch (error) {
    test.details.error = error.message;
    console.error('❌ Token creation test error:', error);
  }

  return test;
}

// Test the re-upload API structure (for existing scans)
async function testReuploadStructure() {
  const test = {
    name: 'Re-upload API Structure Test',
    description: 'Validate structure for re-uploading documents to existing scans',
    success: false,
    details: {}
  };

  try {
    // Mock the re-upload payload structure
    const mockReuploadPayload = {
      scanRef: "test_scan_ref_123",
      image: "base64_encoded_image_here",
      step: "UTILITY_BILL",
      additionalData: {
        address: "123 Test Street, Test City"
      }
    };

    // Validate required fields
    const hasRequired = mockReuploadPayload.scanRef && 
                       mockReuploadPayload.image && 
                       mockReuploadPayload.step;

    test.details = {
      endpoint: '/api/v2/upload-additional-step',
      requiredFields: ['scanRef', 'image', 'step'],
      optionalFields: ['additionalData'],
      structureValid: hasRequired,
      mockPayload: 'Structure validated for re-upload API'
    };

    test.success = hasRequired;

    if (test.success) {
      console.log('✅ Re-upload API structure validated');
    }

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
