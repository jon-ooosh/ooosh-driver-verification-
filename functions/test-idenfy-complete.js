// File: functions/test-idenfy-complete.js
// Enhanced test to verify BOTH file uploads AND field population

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🧪 Enhanced Idenfy test - Testing fields AND file uploads');
  
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
    // Get test parameters
    const params = event.queryStringParameters || {};
    const email = params.email || 'test@oooshtours.co.uk';
    const jobId = params.jobId || '99999';
    const testMode = params.mode || 'full'; // 'full', 'fields_only', 'files_only'
    
    console.log('🔬 Test configuration:', { email, jobId, testMode });

    // Step 1: Test field population
    let fieldTestResult = null;
    if (testMode === 'full' || testMode === 'fields_only') {
      console.log('📊 STEP 1: Testing field population...');
      fieldTestResult = await testFieldPopulation(email, jobId);
    }

    // Step 2: Test file uploads
    let fileTestResult = null;
    if (testMode === 'full' || testMode === 'files_only') {
      console.log('📁 STEP 2: Testing file uploads...');
      fileTestResult = await testFileUploads(email);
    }

    // Step 3: Call actual webhook with comprehensive data
    console.log('🚀 STEP 3: Calling webhook with full mock data...');
    const webhookResult = await callWebhookWithFullData(email, jobId);

    // Step 4: Verify what actually got saved
    console.log('✅ STEP 4: Verifying saved data...');
    const verificationResult = await verifyMondayData(email);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        testConfig: { email, jobId, testMode },
        results: {
          fieldTest: fieldTestResult,
          fileTest: fileTestResult,
          webhookCall: webhookResult,
          verification: verificationResult
        },
        summary: generateSummary(fieldTestResult, fileTestResult, verificationResult)
      }, null, 2)
    };

  } catch (error) {
    console.error('❌ Test failed:', error);
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

// Test that all fields are being populated correctly
async function testFieldPopulation(email, jobId) {
  try {
    // First ensure driver exists
    const findResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'find-driver-board-a',
        email: email
      })
    });

    let driverId = null;
    if (findResponse.ok) {
      const findResult = await findResponse.json();
      driverId = findResult.driver?.id;
    }

    // If no driver, create one first
    if (!driverId) {
      const createResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-driver-board-a',
          email: email,
          name: 'Test Driver'
        })
      });
      
      if (createResponse.ok) {
        const createResult = await createResponse.json();
        driverId = createResult.driverId;
      }
    }

    // Now update with ALL fields that should be populated from Idenfy
    const comprehensiveUpdate = {
      action: 'update-driver-board-a',
      email: email,
      updates: {
        // Personal Info
        firstName: 'JONATHAN MARK',
        lastName: 'WOOD',
        fullName: 'MR JONATHAN MARK WOOD',
        dateOfBirth: '1983-01-09',
        phone: '+447777777777', // This was missing!
        
        // Document Info
        licenseNumber: 'WOOD9801093JM9PX 25',
        licenseEnding: 'JM9PX',
        licenseExpiry: '2029-12-29',
        nationality: 'GB', // This was missing!
        licenseIssuedBy: 'DVLA', // This was missing!
        
        // Address Info
        homeAddress: '5 CLAYTON AVENUE, HASSOCKS, WEST SUSSEX, BN6 8HB', // This was missing!
        
        // Test Info
        datePassedTest: '2001-03-15', // This might not come from Idenfy
        
        // Status Info
        overallStatus: 'Working on it',
        lastUpdated: new Date().toISOString().split('T')[0],
        
        // Insurance Questions (these should come from insurance form, not Idenfy)
        disability: 'No',
        convictions: 'No',
        prosecutions: 'No',
        accidents: 'No',
        insuranceIssues: 'No',
        drivingBan: 'No'
      }
    };

    const updateResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(comprehensiveUpdate)
    });

    const updateResult = await updateResponse.json();
    
    return {
      success: updateResponse.ok,
      driverId: driverId,
      fieldsAttempted: Object.keys(comprehensiveUpdate.updates),
      updateResult: updateResult,
      missingFields: identifyMissingFields(updateResult)
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Test file uploads with the new fix
async function testFileUploads(email) {
  try {
    const fileTypes = ['license_front', 'license_back', 'poa1', 'poa2', 'signature'];
    const results = {};
    
    // Small test image (1x1 PNG)
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    
    for (const fileType of fileTypes) {
      console.log(`📤 Testing ${fileType} upload...`);
      
      const uploadResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload-file-board-a',
          email: email,
          fileType: fileType,
          fileData: testImageBase64,
          filename: `test_${fileType}.png`
        })
      });

      const uploadResult = await uploadResponse.json();
      results[fileType] = {
        success: uploadResponse.ok && uploadResult.success,
        status: uploadResponse.status,
        fileId: uploadResult.fileId,
        error: uploadResult.error
      };
      
      // Small delay between uploads
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return {
      success: Object.values(results).every(r => r.success),
      uploadResults: results,
      summary: `${Object.values(results).filter(r => r.success).length}/${fileTypes.length} uploads successful`
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Call webhook with comprehensive mock data
async function callWebhookWithFullData(email, jobId) {
  try {
    const encodedEmail = email.replace('@', '_at_').replace(/\./g, '_dot_');
    const timestamp = Date.now();
    
    const mockWebhookData = {
      final: true,
      platform: "MOBILE",
      clientId: `ooosh_${jobId}_${encodedEmail}_${timestamp}`,
      scanRef: `test-${timestamp}`,
      status: {
        overall: "APPROVED",
        autoFace: "FACE_MATCH",
        manualFace: "FACE_MATCH",
        autoDocument: "DOC_VALIDATED",
        manualDocument: "DOC_VALIDATED",
        additionalSteps: "VALID"
      },
      data: {
        // Names
        docFirstName: "MR JONATHAN MARK",
        docLastName: "WOOD",
        fullName: "MR JONATHAN MARK WOOD",
        
        // Document details
        docNumber: "WOOD9801093JM9PX 25",
        docExpiry: "2029-12-29",
        docDob: "1983-01-09",
        docType: "DRIVER_LICENSE",
        docSex: "MALE",
        
        // Nationality and issuing info
        docNationality: "GB",
        nationality: "GB", // Try both field names
        docIssuingCountry: "GB",
        authority: "DVLA",
        
        // Address
        address: "5 CLAYTON AVENUE, HASSOCKS, WEST SUSSEX, BN6 8HB",
        manualAddress: "5 CLAYTON AVENUE, HASSOCKS, WEST SUSSEX, BN6 8HB",
        
        // License categories
        driverLicenseCategory: "AM/A/B1/B/F/K/P/Q",
        
        // Additional fields that might be needed
        birthPlace: "UNITED KINGDOM",
        selectedCountry: "GB"
      },
      // Mock file URLs (these would be real S3 URLs from Idenfy)
      fileUrls: {
        FRONT: "https://s3.eu-west-1.amazonaws.com/mock/license-front.jpg",
        BACK: "https://s3.eu-west-1.amazonaws.com/mock/license-back.jpg",
        FACE: "https://s3.eu-west-1.amazonaws.com/mock/face.jpg"
      },
      additionalStepPdfUrls: {
        UTILITY_BILL: "https://s3.eu-west-1.amazonaws.com/mock/poa1.pdf",
        POA2: "https://s3.eu-west-1.amazonaws.com/mock/poa2.pdf"
      }
    };

    console.log('📨 Calling idenfy-webhook with comprehensive data...');
    
    const response = await fetch(`${process.env.URL}/.netlify/functions/idenfy-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockWebhookData)
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      result = { rawResponse: responseText };
    }

    return {
      success: response.ok,
      status: response.status,
      result: result,
      dataSent: {
        hasNationality: !!mockWebhookData.data.docNationality,
        hasAuthority: !!mockWebhookData.data.authority,
        hasAddress: !!mockWebhookData.data.address,
        hasFiles: !!mockWebhookData.fileUrls
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Verify what actually got saved in Monday.com
async function verifyMondayData(email) {
  try {
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'find-driver-board-a',
        email: email
      })
    });

    if (!response.ok) {
      return { success: false, error: 'Driver not found' };
    }

    const result = await response.json();
    const driver = result.driver;
    
    if (!driver) {
      return { success: false, error: 'No driver data returned' };
    }

    // Check which fields are populated
    const fieldChecks = {
      email: !!driver.email,
      firstName: !!driver.firstName,
      lastName: !!driver.lastName,
      fullName: !!driver.fullName,
      dateOfBirth: !!driver.dateOfBirth,
      phone: !!driver.phone,
      nationality: !!driver.nationality,
      licenseNumber: !!driver.licenseNumber,
      licenseEnding: !!driver.licenseEnding,
      licenseExpiry: !!driver.licenseExpiry,
      licenseIssuedBy: !!driver.licenseIssuedBy,
      homeAddress: !!driver.homeAddress,
      datePassedTest: !!driver.datePassedTest,
      overallStatus: !!driver.overallStatus
    };

    const populatedFields = Object.entries(fieldChecks)
      .filter(([_, populated]) => populated)
      .map(([field, _]) => field);
    
    const missingFields = Object.entries(fieldChecks)
      .filter(([_, populated]) => !populated)
      .map(([field, _]) => field);

    return {
      success: true,
      driverId: driver.id,
      populatedFields: populatedFields,
      missingFields: missingFields,
      fieldCount: `${populatedFields.length}/${Object.keys(fieldChecks).length} fields populated`,
      criticalFieldsMissing: missingFields.filter(f => 
        ['phone', 'nationality', 'licenseIssuedBy', 'homeAddress'].includes(f)
      )
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Generate summary of test results
function generateSummary(fieldTest, fileTest, verification) {
  const issues = [];
  const successes = [];
  
  if (fieldTest?.success) {
    successes.push('✅ Field updates working');
  } else {
    issues.push('❌ Field updates failing');
  }
  
  if (fileTest?.success) {
    successes.push('✅ All file uploads working');
  } else if (fileTest?.uploadResults) {
    const failedUploads = Object.entries(fileTest.uploadResults)
      .filter(([_, r]) => !r.success)
      .map(([type, _]) => type);
    if (failedUploads.length > 0) {
      issues.push(`❌ File uploads failing: ${failedUploads.join(', ')}`);
    }
  }
  
  if (verification?.criticalFieldsMissing?.length > 0) {
    issues.push(`⚠️ Critical fields missing: ${verification.criticalFieldsMissing.join(', ')}`);
  }
  
  return {
    overallStatus: issues.length === 0 ? '🎉 ALL TESTS PASSING' : '⚠️ ISSUES FOUND',
    successes: successes,
    issues: issues,
    nextSteps: issues.length > 0 ? 
      ['Review idenfy-webhook.js field mapping', 'Check Monday.com column IDs', 'Verify file upload implementation'] :
      ['Ready for production testing']
  };
}

// Helper to identify which fields are missing
function identifyMissingFields(updateResult) {
  const criticalFields = ['phone', 'nationality', 'licenseIssuedBy', 'homeAddress'];
  const missing = [];
  
  // This would need to parse the actual update result to see what failed
  // For now, return empty array
  return missing;
}
