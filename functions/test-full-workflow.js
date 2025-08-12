// File: functions/test-full-workflow.js
// Test the complete driver verification workflow end-to-end
// This simulates the full process for testing

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Full workflow test started');
  
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
    const testEmail = 'workflow-test@example.com';
    const testJobId = 'JOB001';
    const testResults = [];

    console.log('🧪 Testing full driver verification workflow...');

    // Step 1: Test driver status (should be new)
    console.log('📋 Step 1: Checking initial driver status...');
    try {
      const statusResponse = await fetch(`${process.env.URL}/.netlify/functions/driver-status?email=${encodeURIComponent(testEmail)}`);
      const statusResult = await statusResponse.json();
      
      testResults.push({
        step: 'Initial Driver Status',
        success: statusResult.status === 'new',
        result: statusResult,
        expected: 'status: new'
      });
      
      console.log('✅ Driver status check:', statusResult.status);
    } catch (error) {
      testResults.push({
        step: 'Initial Driver Status',
        success: false,
        error: error.message
      });
    }

    // Step 2: Test email verification sending
    console.log('📧 Step 2: Testing email verification...');
    try {
      const emailResponse = await fetch(`${process.env.URL}/.netlify/functions/send-verification-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, jobId: testJobId })
      });
      
      const emailResult = await emailResponse.json();
      
      testResults.push({
        step: 'Send Verification Email',
        success: emailResult.success,
        result: emailResult,
        expected: 'success: true'
      });
      
      console.log('✅ Email verification:', emailResult.success ? 'sent' : 'failed');
    } catch (error) {
      testResults.push({
        step: 'Send Verification Email',
        success: false,
        error: error.message
      });
    }

    // Step 3: Test Monday.com driver creation with New System tag
    console.log('📊 Step 3: Testing Monday.com integration...');
    try {
      const mondayResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-driver',
          email: testEmail,
          jobId: testJobId,
          name: 'Test Workflow Driver' // Test with actual name
        })
      });
      
      const mondayResult = await mondayResponse.json();
      
      testResults.push({
        step: 'Monday.com Driver Creation (New System)',
        success: mondayResult.success,
        result: mondayResult,
        expected: 'success: true, itemId returned, New System tag applied'
      });
      
      console.log('✅ Monday.com integration:', mondayResult.success ? 'working' : 'failed');
    } catch (error) {
      testResults.push({
        step: 'Monday.com Driver Creation (New System)',
        success: false,
        error: error.message
      });
    }

    // Step 4: Test insurance data saving
    console.log('📋 Step 4: Testing insurance questionnaire...');
    try {
      const insuranceData = {
        hasDisability: 'no',
        hasConvictions: 'no',
        hasProsecution: 'no',
        hasAccidents: 'no',
        hasInsuranceIssues: 'no',
        hasDrivingBan: 'no',
        additionalDetails: 'Test workflow data'
      };

      const insuranceResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-insurance-data',
          email: testEmail,
          jobId: testJobId,
          insuranceData: insuranceData
        })
      });
      
      const insuranceResult = await insuranceResponse.json();
      
      testResults.push({
        step: 'Insurance Data Save',
        success: insuranceResult.success,
        result: insuranceResult,
        expected: 'Insurance data saved to Monday.com'
      });
      
      console.log('✅ Insurance questionnaire:', insuranceResult.success ? 'saved' : 'failed');
    } catch (error) {
      testResults.push({
        step: 'Insurance Data Save',
        success: false,
        error: error.message
      });
    }

    // Step 5: Test AWS Textract OCR (with mock DVLA data)
    console.log('📁 Step 5.5: Testing Idenfy results with file uploads...');
    try {
      const mockIdenfyData = {
        name: 'Test Workflow Driver',
        licenseNumber: 'TEST661120TW9DR',
        licenseExpiryDate: '2030-12-31',
        licenseAddress: '123 Test Street, Test City, TE1 2ST',
        dateOfBirth: '1990-01-15',
        status: 'Working on it',
        documentImages: {
          licenseFront: 'https://example.com/license-front.jpg',
          licenseBack: 'https://example.com/license-back.jpg',
          passport: 'https://example.com/passport.jpg',
          poa1: 'https://example.com/poa1.pdf',
          poa2: 'https://example.com/poa2.pdf'
        }
      };

      const idenfyResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-idenfy-results',
          email: testEmail,
          jobId: testJobId,
          mondayData: mockIdenfyData
        })
      });
      
      const idenfyResult = await idenfyResponse.json();
      
      testResults.push({
        step: 'Idenfy Results + File References',
        success: idenfyResult.success,
        result: idenfyResult,
        expected: 'Driver name updated, license info saved, file references stored'
      });
      
      console.log('✅ Idenfy results with files:', idenfyResult.success ? 'saved' : 'failed');
    } catch (error) {
      testResults.push({
        step: 'Idenfy Results + File References',
        success: false,
        error: error.message
      });
    }
    console.log('🔍 Step 5: Testing AWS Textract DVLA processing...');
    try {
      // Create a small test image (1x1 pixel PNG in base64)
      const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      
      const textractResponse = await fetch(`${process.env.URL}/.netlify/functions/test-claude-ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testType: 'dvla',
          imageData: testImageBase64,
          fileType: 'image'
        })
      });
      
      const textractResult = await textractResponse.json();
      
      testResults.push({
        step: 'AWS Textract DVLA Processing',
        success: textractResult.success,
        result: textractResult.result,
        expected: 'DVLA data extraction and insurance decision'
      });
      
      console.log('✅ AWS Textract:', textractResult.success ? 'working' : 'failed');
    } catch (error) {
      testResults.push({
        step: 'AWS Textract DVLA Processing',
        success: false,
        error: error.message
      });
    }

    // Step 6: Test updated driver status (should show progress)
    console.log('📊 Step 6: Checking final driver status...');
    try {
      // Wait a moment for updates to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const finalStatusResponse = await fetch(`${process.env.URL}/.netlify/functions/driver-status?email=${encodeURIComponent(testEmail)}`);
      const finalStatusResult = await finalStatusResponse.json();
      
      testResults.push({
        step: 'Final Driver Status',
        success: finalStatusResult.status !== 'new',
        result: finalStatusResult,
        expected: 'status: partial/verified (not new)'
      });
      
      console.log('✅ Final status check:', finalStatusResult.status);
    } catch (error) {
      testResults.push({
        step: 'Final Driver Status',
        success: false,
        error: error.message
      });
    }

    // Calculate overall success
    const successfulSteps = testResults.filter(test => test.success).length;
    const totalSteps = testResults.length;
    const overallSuccess = successfulSteps === totalSteps;

    console.log(`🎯 Workflow test complete: ${successfulSteps}/${totalSteps} steps passed`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: overallSuccess,
        summary: `${successfulSteps}/${totalSteps} steps passed`,
        totalSteps: totalSteps,
        successfulSteps: successfulSteps,
        overallSuccess: overallSuccess,
        testResults: testResults,
        testEmail: testEmail,
        testJobId: testJobId,
        timestamp: new Date().toISOString(),
        recommendation: overallSuccess ? 
          '🎉 All systems working! Ready for production testing.' :
          '⚠️ Some issues found. Check failed steps and resolve before production.'
      })
    };

  } catch (error) {
    console.error('Full workflow test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Workflow test failed',
        details: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};
