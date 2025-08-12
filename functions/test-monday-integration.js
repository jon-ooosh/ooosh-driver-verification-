// ONCE IN PRODUCTION I THINK WE CAN DELETE THIS???
// File: functions/test-monday-integration.js
// OOOSH Driver Verification - Monday.com Integration Test Function
// Tests all Monday.com functionality before switching from Google Sheets

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Monday.com Integration Test starting...');
  
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
      testEmail: 'test-monday@oooshtours.co.uk',
      testJobId: 'JOB001',
      tests: {},
      summary: {
        passed: 0,
        failed: 0,
        total: 0
      }
    };

    console.log('🧪 Starting Monday.com Integration Tests...');

    // Test 1: Connection Test
    testResults.tests.connection = await runTest(
      'Monday.com API Connection',
      async () => {
        const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'test-connection' })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || 'Connection test failed');
        }
        
        return {
          success: true,
          boardId: result.board?.id,
          boardName: result.board?.name,
          columnCount: result.board?.columnCount
        };
      }
    );

    // Test 2: Check New Driver Status
    testResults.tests.newDriverStatus = await runTest(
      'Get New Driver Status',
      async () => {
        const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration?action=get-driver-status&email=new-driver-test@example.com`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.status !== 'new' || result.existingDriver !== false) {
          throw new Error(`Expected new driver status, got: ${result.status}`);
        }
        
        return {
          success: true,
          status: result.status,
          documentsRequired: result.needsUpdate?.length || 0
        };
      }
    );

    // Test 3: Create Driver
    testResults.tests.createDriver = await runTest(
      'Create New Driver',
      async () => {
        const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create-driver',
            email: testResults.testEmail,
            jobId: testResults.testJobId,
            jobNumber: '12345',
            driverName: 'Test Driver Monday'
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.success || !result.mondayItemId) {
          throw new Error(result.error || 'Failed to create driver');
        }
        
        // Store the item ID for later tests
        testResults.mondayItemId = result.mondayItemId;
        
        return {
          success: true,
          mondayItemId: result.mondayItemId,
          itemName: result.itemName
        };
      }
    );

    // Test 4: Save Insurance Data
    testResults.tests.saveInsurance = await runTest(
      'Save Insurance Questionnaire',
      async () => {
        const insuranceData = {
          hasDisability: 'no',
          hasConvictions: 'yes',
          hasProsecution: 'no',
          hasAccidents: 'yes',
          hasInsuranceIssues: 'no',
          hasDrivingBan: 'no',
          additionalDetails: 'Test insurance details for Monday.com integration'
        };

        const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save-insurance-data',
            email: testResults.testEmail,
            insuranceData: insuranceData,
            mondayItemId: testResults.mondayItemId
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to save insurance data');
        }
        
        return {
          success: true,
          message: result.message
        };
      }
    );

    // Test 5: Save Idenfy Results
    testResults.tests.saveIdenfy = await runTest(
      'Save Idenfy Verification Results',
      async () => {
        const idenfyData = {
          firstName: 'Test',
          lastName: 'Driver',
          licenseNumber: 'TEST123456AB9CD',
          dateOfBirth: '1990-01-15',
          licenseExpiry: '2030-12-31',
          address: '123 Test Street, London, SW1A 1AA',
          approved: true
        };

        const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save-idenfy-results',
            email: testResults.testEmail,
            idenfyData: idenfyData,
            mondayItemId: testResults.mondayItemId
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to save Idenfy results');
        }
        
        return {
          success: true,
          message: result.message
        };
      }
    );

    // Test 6: Save DVLA Results
    testResults.tests.saveDvla = await runTest(
      'Save DVLA OCR Results',
      async () => {
        const dvlaData = {
          licenseNumber: 'TEST123456AB9CD',
          driverName: 'MR TEST DRIVER',
          checkCode: 'te st 12 34',
          dateGenerated: '2025-07-15',
          validFrom: '2020-01-01',
          validTo: '2030-12-31',
          totalPoints: 3,
          endorsements: [{
            code: 'SP30',
            points: 3,
            description: 'Exceeding statutory speed limit'
          }],
          insuranceDecision: {
            approved: true,
            excess: 0,
            riskLevel: 'standard',
            reasons: ['Minor points - standard approval']
          }
        };

        const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save-dvla-results',
            email: testResults.testEmail,
            dvlaData: dvlaData,
            mondayItemId: testResults.mondayItemId
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to save DVLA results');
        }
        
        return {
          success: true,
          insuranceDecision: result.insuranceDecision,
          message: result.message
        };
      }
    );

    // Test 7: Check Existing Driver Status
    testResults.tests.existingDriverStatus = await runTest(
      'Get Existing Driver Status',
      async () => {
        // Wait a moment for Monday.com to update
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration?action=get-driver-status&email=${testResults.testEmail}`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.existingDriver || !result.mondayItemId) {
          throw new Error(`Expected existing driver, got status: ${result.status}`);
        }
        
        return {
          success: true,
          status: result.status,
          name: result.name,
          mondayItemId: result.mondayItemId,
          documents: result.documents
        };
      }
    );

    // Test 8: Signature Upload (Framework Test)
    testResults.tests.signatureUpload = await runTest(
      'Signature Upload Framework',
      async () => {
        const mockSignature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

        const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload-signature',
            email: testResults.testEmail,
            signatureData: mockSignature,
            mondayItemId: testResults.mondayItemId
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to upload signature');
        }
        
        return {
          success: true,
          message: result.message,
          note: result.note
        };
      }
    );

    // Calculate summary
    for (const testName in testResults.tests) {
      testResults.summary.total++;
      if (testResults.tests[testName].success) {
        testResults.summary.passed++;
      } else {
        testResults.summary.failed++;
      }
    }

    // Generate test report
    const overallSuccess = testResults.summary.failed === 0;
    console.log(`🧪 Tests completed: ${testResults.summary.passed}/${testResults.summary.total} passed`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: overallSuccess,
        message: overallSuccess ? 
          'All Monday.com integration tests passed! Ready to switch from Google Sheets.' :
          `${testResults.summary.failed} test(s) failed. Check details and fix issues.`,
        results: testResults,
        nextSteps: overallSuccess ? [
          'Update driver-status.js to use Monday.com',
          'Update verification workflow to save to Monday.com',
          'Remove Google Sheets dependencies',
          'Deploy to production'
        ] : [
          'Fix failing tests',
          'Check Monday.com API token and permissions',
          'Verify board ID and column IDs are correct',
          'Re-run tests until all pass'
        ]
      })
    };

  } catch (error) {
    console.error('Test execution error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Test execution failed',
        details: error.message 
      })
    };
  }
};

// Helper function to run individual tests with error handling
async function runTest(testName, testFunction) {
  console.log(`🔄 Running test: ${testName}`);
  
  try {
    const startTime = Date.now();
    const result = await testFunction();
    const duration = Date.now() - startTime;
    
    console.log(`✅ Test passed: ${testName} (${duration}ms)`);
    
    return {
      success: true,
      duration: duration,
      result: result
    };
    
  } catch (error) {
    console.error(`❌ Test failed: ${testName} - ${error.message}`);
    
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}
