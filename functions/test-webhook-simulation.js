// File: functions/test-webhook-simulation.js
// DEBUG VERSION - More detailed error logging

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🧪 DEBUG: Webhook simulation test called');
  
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
    
    console.log('🧪 DEBUG: Testing with:', { testEmail, testJobId });

    // Step 1: First test if Monday.com integration works directly
    console.log('🔍 DEBUG: Testing Monday.com integration first...');
    const mondayTest = await testMondayDirectly(testEmail, testJobId);
    
    if (!mondayTest.success) {
      console.log('❌ DEBUG: Monday.com test failed, stopping here');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          step: 'monday_test',
          error: mondayTest.error,
          message: 'Monday.com integration failed - fixing this first before webhook test'
        })
      };
    }

    console.log('✅ DEBUG: Monday.com works, now testing webhook...');

    // Step 2: Test the webhook with detailed error catching
    const webhookResult = await simulateWebhookCallWithDebug(testEmail, testJobId);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: webhookResult.success,
        mondayTest: mondayTest,
        webhookResult: webhookResult,
        testEmail: testEmail,
        testJobId: testJobId,
        debug: 'Detailed logging enabled'
      })
    };

  } catch (error) {
    console.error('🚨 DEBUG: Top level error:', error);
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

// Test Monday.com integration directly first
async function testMondayDirectly(email, jobId) {
  try {
    console.log('🔍 DEBUG: Testing find-driver-board-a...');
    
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
    console.log('📊 DEBUG: Monday.com response:', { status: response.status, result });

    if (response.ok) {
      return {
        success: true,
        driverExists: result.success,
        message: result.success ? 'Driver found' : 'Driver not found (normal for new driver)'
      };
    } else {
      return {
        success: false,
        error: `Monday.com error: ${response.status} - ${result.error || 'Unknown error'}`
      };
    }

  } catch (error) {
    console.error('❌ DEBUG: Monday.com test error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Simulate webhook with detailed debug logging
async function simulateWebhookCallWithDebug(testEmail, testJobId) {
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
    manualAddressMatch: true,
    additionalData: {
      POA2: {
        address2: {
          value: "5 Clayton Avenue Hassocks West Sussex BN6 8HB",
          status: "MATCH"
        }
      },
      UTILITY_BILL: {
        address: {
          value: "5 CLAYTON AVENUE HASSOCKS WEST SUSSEX BN6 8HB", 
          status: "MATCH"
        }
      }
    }
  };

  try {
    console.log('🔗 DEBUG: Calling idenfy-webhook with clientId:', mockWebhookData.clientId);
    
    const response = await fetch(`${process.env.URL}/.netlify/functions/idenfy-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mockWebhookData)
    });

    console.log('📊 DEBUG: Webhook response status:', response.status);
    
    const responseText = await response.text();
    console.log('📊 DEBUG: Webhook response text:', responseText);
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      result = { rawResponse: responseText, parseError: parseError.message };
    }
    
    if (response.ok) {
      console.log('✅ DEBUG: Webhook successful');
      return {
        success: true,
        nextStep: result.nextStep || 'unknown',
        boardACreated: result.boardAUpdated || false,
        webhookResponse: result
      };
    } else {
      console.log('❌ DEBUG: Webhook failed');
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`,
        details: result.details || 'No details',
        rawResponse: responseText
      };
    }

  } catch (error) {
    console.error('❌ DEBUG: Webhook call exception:', error);
    return {
      success: false,
      error: error.message,
      type: 'network_error'
    };
  }
}

// Simulate the actual webhook call
async function simulateWebhookCall(testEmail, testJobId) {
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
    manualAddressMatch: true,
    additionalData: {
      POA2: {
        address2: {
          value: "5 Clayton Avenue Hassocks West Sussex BN6 8HB",
          status: "MATCH"
        }
      },
      UTILITY_BILL: {
        address: {
          value: "5 CLAYTON AVENUE HASSOCKS WEST SUSSEX BN6 8HB", 
          status: "MATCH"
        }
      }
    }
  };

  try {
    const response = await fetch(`${process.env.URL}/.netlify/functions/idenfy-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mockWebhookData)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Webhook simulation successful');
      return {
        success: true,
        nextStep: result.nextStep,
        boardACreated: result.boardAUpdated,
        webhookResponse: result
      };
    } else {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

  } catch (error) {
    console.error('❌ Webhook call failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Test file uploads to Monday.com (from your Session 24 success)
async function testFileUploads(email) {
  const testFiles = [
    { type: 'license_front', name: 'License Front' },
    { type: 'license_back', name: 'License Back' },
    { type: 'poa1', name: 'POA Document 1' },
    { type: 'poa2', name: 'POA Document 2' },
    { type: 'signature', name: 'Signature' }
  ];

  const uploadResults = {};

  // Create a small test image (1x1 pixel PNG in base64)
  const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

  for (const file of testFiles) {
    try {
      console.log(`📎 Testing ${file.name} upload...`);
      
      const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'upload-file-board-a',
          email: email,
          fileType: file.type,
          fileData: testImageBase64,
          filename: `test_${file.type}.png`
        })
      });

      const result = await response.json();
      uploadResults[file.type] = {
        success: result.success,
        fileId: result.fileId,
        message: result.message || result.error
      };

      console.log(`${result.success ? '✅' : '❌'} ${file.name}: ${result.success ? 'Success' : result.error}`);

    } catch (error) {
      uploadResults[file.type] = {
        success: false,
        error: error.message
      };
    }
  }

  return uploadResults;
}

// Generate redirect URL based on next step
function generateRedirectUrl(email, jobId, nextStep) {
  const baseUrl = process.env.URL || 'https://ooosh-driver-verification.netlify.app';
  
  switch (nextStep) {
    case 'dvla_check_required':
      return `${baseUrl}/?status=success&job=${jobId}&email=${encodeURIComponent(email)}&step=dvla`;
    case 'aws_ocr_validation':
      return `${baseUrl}/?status=success&job=${jobId}&email=${encodeURIComponent(email)}&step=poa`;
    case 'complete':
      return `${baseUrl}/?status=success&job=${jobId}&email=${encodeURIComponent(email)}`;
    default:
      return `${baseUrl}/?status=success&job=${jobId}&email=${encodeURIComponent(email)}`;
  }
}
