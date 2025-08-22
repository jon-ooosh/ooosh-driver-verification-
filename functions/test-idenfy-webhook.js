// File: functions/test-idenfy-webhook.js
// Quick webhook tester to bypass Idenfy flow

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🧪 Test Idenfy webhook simulator called');
  
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
    // Get test parameters from query string or body
    const params = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};
    
    const email = params.email || body.email || 'testdriver@oooshtours.co.uk';
    const jobId = params.jobId || body.jobId || '99999';
    const testType = params.type || body.type || 'full'; // full, additional_steps
    
    console.log('🔬 Testing webhook with:', { email, jobId, testType });

    // Create mock Idenfy webhook payload
    const mockWebhookData = createMockWebhookData(email, jobId, testType);
    
    console.log('📨 Calling webhook with mock data...');
    
    // Call the actual webhook
    const webhookUrl = `${process.env.URL}/.netlify/functions/idenfy-webhook`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mockWebhookData)
    });

    const responseText = await response.text();
    console.log('📊 Webhook response:', { 
      status: response.status, 
      body: responseText.substring(0, 500) 
    });

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      result = { rawResponse: responseText, parseError: e.message };
    }

    // Return test results
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: response.ok,
        testParameters: { email, jobId, testType },
        webhookResponse: {
          status: response.status,
          result: result
        },
        mockDataSent: {
          clientId: mockWebhookData.clientId,
          scanRef: mockWebhookData.scanRef,
          hasDocuments: !!mockWebhookData.fileUrls,
          hasAdditionalSteps: !!mockWebhookData.additionalStepPdfUrls
        },
        nextActions: response.ok ? 
          ['Check Monday.com for updated data', 'Proceed with DVLA upload'] :
          ['Fix webhook errors', 'Check logs']
      }, null, 2)
    };

  } catch (error) {
    console.error('❌ Test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Test failed',
        details: error.message,
        stack: error.stack
      })
    };
  }
};

function createMockWebhookData(email, jobId, testType) {
  const encodedEmail = email.replace('@', '_at_').replace(/\./g, '_dot_');
  const timestamp = Date.now();
  const scanRef = `test-${Math.random().toString(36).substr(2, 9)}`;
  
  const baseData = {
    final: true,
    platform: "MOBILE",
    clientId: `ooosh_${jobId}_${encodedEmail}_${timestamp}`,
    scanRef: scanRef,
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
      additionalSteps: testType === 'additional_steps' ? "VALID" : null,
      amlResultClass: null,
      pepsStatus: "NOT_CHECKED",
      sanctionsStatus: "NOT_CHECKED",
      adverseMediaStatus: "NOT_CHECKED"
    },
    data: {
      docFirstName: "MR JONATHAN MARK",
      docLastName: "WOOD",
      docNumber: "WOOD9801093JM9PX",
      docDob: "1983-01-09",
      docExpiry: "2029-12-29",
      docNationality: "GB",
      docIssuingCountry: "GB",
      manualAddress: "5 CLAYTON AVENUE, HASSOCKS, WEST SUSSEX, BN6 8HB",
      scanRef: scanRef,
      clientId: `ooosh_${jobId}_${encodedEmail}_${timestamp}`,
      startedFromDevice: "MOBILE_SDK"
    }
  };

  if (testType === 'full') {
    // Full verification with documents and POAs
    baseData.fileUrls = {
      FRONT: "https://s3.eu-west-1.amazonaws.com/mock/license-front.jpg",
      BACK: "https://s3.eu-west-1.amazonaws.com/mock/license-back.jpg",
      FACE: "https://s3.eu-west-1.amazonaws.com/mock/face.jpg"
    };
    baseData.additionalStepPdfUrls = {
      UTILITY_BILL: "https://s3.eu-west-1.amazonaws.com/mock/poa1.pdf",
      POA2: "https://s3.eu-west-1.amazonaws.com/mock/poa2.pdf"
    };
  } else if (testType === 'additional_steps') {
    // Additional Steps re-upload (POA only)
    baseData.additionalStepPdfUrls = {
      UTILITY_BILL: "https://s3.eu-west-1.amazonaws.com/mock/new-poa.pdf"
    };
    // No primary documents for re-upload
    delete baseData.data.docFirstName;
    delete baseData.data.docLastName;
  }

  return baseData;
}
