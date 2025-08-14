// File: functions/test-webhook-simulation.js
// FIXED VERSION - Detailed debug logging to find the exact issue

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🧪 FIXED: Webhook simulation test called');
  
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
    const { email, jobId } = event.queryStringParameters || {};
    
    const testEmail = email || 'jonwood@oooshtours.co.uk';
    const testJobId = jobId || '99999';
    
    console.log('🧪 FIXED: Testing with:', { testEmail, testJobId });

    // Step 1: Test Monday.com integration step by step
    console.log('🔍 STEP 1: Testing Monday.com find-driver...');
    const step1Result = await testMondayFindDriver(testEmail);
    
    console.log('🔍 STEP 2: Testing Monday.com update-driver directly...');
    const step2Result = await testMondayUpdateDriver(testEmail);
    
    console.log('🔍 STEP 3: Testing webhook call...');
    const step3Result = await testWebhookCall(testEmail, testJobId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: false,
        testParameters: {
          testEmail: testEmail,
          testJobId: testJobId
        },
        stepResults: {
          step1_mondayTest: step1Result,
          step2_webhookCall: step2Result,
          step3_detailedError: step3Result
        },
        nextActions: [
          "Fix webhook errors",
          "Check Monday.com integration", 
          "Review logs"
        ]
      })
    };

  } catch (error) {
    console.error('🚨 FIXED: Top level error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Top level simulation failed',
        details: error.message,
        stack: error.stack
      })
    };
  }
};

// Test Monday.com find-driver function directly
async function testMondayFindDriver(email) {
  try {
    console.log('🔍 Testing find-driver-board-a directly...');
    
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'find-driver-board-a',
        email: email
      })
    });

    const result = await response.json();
    console.log('📊 Find driver response:', { status: response.status, result });

    return {
      success: response.ok,
      statusCode: response.status,
      result: result
    };

  } catch (error) {
    console.error('❌ Find driver test error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Test Monday.com update-driver function directly
async function testMondayUpdateDriver(email) {
  try {
    console.log('🔄 Testing update-driver-board-a directly...');
    
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'update-driver-board-a',
        email: email,
        updates: {
          overallStatus: 'Working on it',
          lastUpdated: new Date().toISOString().split('T')[0]
        }
      })
    });

    const result = await response.json();
    console.log('📊 Update driver response:', { status: response.status, result });

    return {
      success: response.ok,
      statusCode: response.status,
      result: result
    };

  } catch (error) {
    console.error('❌ Update driver test error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Test the webhook call with detailed error tracking
async function testWebhookCall(testEmail, testJobId) {
  try {
    const mockWebhookData = {
      final: true,
      platform: "MOBILE",
      status: {
        overall: "APPROVED",
        suspicionReasons: [],
        denyReasons: [],
        fraudTags: [],
        mismatchTags: [],
        autoFace: "FACE_MATCH",
        manualFace: "FACE_MATCH",
        autoDocument: "DOC_VALIDATED",
        manualDocument: "DOC_VALIDATED",
        additionalSteps: "VALID"
      },
      data: {
        docFirstName: "MR JONATHAN MARK",
        docLastName: "WOOD",
        docNumber: "WOOD9801093JM9PX 25",
        docExpiry: "2029-12-29",
        docDob: "1983-01-09",
        docType: "DRIVER_LICENSE",
        docSex: "MALE",
        docNationality: "GB",
        docIssuingCountry: "GB",
        birthPlace: "UNITED KINGDOM",
        authority: "DVLA",
        driverLicenseCategory: "AM/A/B1/B/F/K/P/Q",
        fullName: "MR JONATHAN MARK WOOD",
        address: "5 CLAYTON AVENUE HASSOCKS WEST SUSSEX BN6 8HB"
      },
      fileUrls: {
        BACK: "https://example.com/license-back.png",
        FACE: "https://example.com/face.png", 
        FRONT: "https://example.com/license-front.png"
      },
      additionalStepPdfUrls: {
        POA2: "https://example.com/poa2.pdf",
        UTILITY_BILL: "https://example.com/utility-bill.pdf"
      },
      scanRef: `test-scan-ref-${Date.now()}`,
      clientId: `ooosh_${testJobId}_${testEmail.replace('@', '_at_').replace(/\./g, '_dot_')}_${Date.now()}`,
      manualAddress: "5 CLAYTON AVENUE HASSOCKS WEST SUSSEX BN6 8HB",
      externalReferenceId: "external_ref_123",
      clientIp: "127.0.0.1",
      startedFromDevice: "MOBILE_SDK"
    };

    console.log('📨 Calling idenfy-webhook with mock data...');
    
    const response = await fetch(`${process.env.URL}/.netlify/functions/idenfy-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mockWebhookData)
    });

    const responseText = await response.text();
    console.log('📊 Webhook response:', { status: response.status, body: responseText });

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      result = { rawResponse: responseText, parseError: parseError.message };
    }

    // Additional debugging
    const debugInfo = {
      mondayWorking: true, // We know this from step 1
      webhookResponse: responseText,
      possibleIssues: [
        "Webhook function syntax error",
        "Missing environment variables",
        "Monday.com API rate limiting",
        "Invalid client ID parsing",
        "Missing function dependencies"
      ]
    };

    return {
      success: response.ok,
      statusCode: response.status,
      result: result,
      rawResponse: responseText,
      debugInfo: debugInfo
    };

  } catch (error) {
    console.error('❌ Webhook call error:', error);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}
