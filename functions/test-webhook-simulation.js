// File: functions/test-webhook-simulation.js
// ENHANCED DEBUG VERSION - Step by step testing

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('🧪 ENHANCED DEBUG: Webhook simulation starting');
  
  const testEmail = event.queryStringParameters?.email || 'jonwood@oooshtours.co.uk';
  const testJobId = event.queryStringParameters?.jobId || '99999';
  
  console.log('🧪 Test parameters:', { testEmail, testJobId });
  
  const results = {
    step1_mondayTest: null,
    step2_webhookCall: null,
    step3_detailedError: null,
    success: false
  };

  try {
    // STEP 1: Test Monday.com directly first
    console.log('📋 STEP 1: Testing Monday.com connection directly...');
    
    try {
      const mondayResponse = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'find-driver-board-a',
          email: testEmail
        })
      });

      const mondayResult = await mondayResponse.json();
      results.step1_mondayTest = {
        success: true,
        statusCode: mondayResponse.status,
        result: mondayResult
      };
      console.log('✅ STEP 1 SUCCESS: Monday.com working:', mondayResult);
      
    } catch (mondayError) {
      results.step1_mondayTest = {
        success: false,
        error: mondayError.message
      };
      console.log('❌ STEP 1 FAILED: Monday.com error:', mondayError.message);
    }

    // STEP 2: Test webhook call with minimal data
    console.log('🔗 STEP 2: Testing webhook call...');
    
    const minimalWebhookData = {
      final: true, // CRITICAL: Must include this field
      clientId: `ooosh_${testJobId}_${testEmail.replace('@', '_at_').replace(/\./g, '_dot_')}_${Date.now()}`,
      scanRef: `test_scan_${testJobId}`,
      status: {
        overall: 'APPROVED',
        autoDocument: 'DOC_VALIDATED',
        autoFace: 'FACE_MATCH',
        manualDocument: 'DOC_VALIDATED',
        manualFace: 'FACE_MATCH',
        mismatchTags: [],
        fraudTags: [],
        suspicionReasons: []
      },
      data: {
        scanRef: `test_scan_${testJobId}`,
        docFirstName: 'Jon',
        docLastName: 'Wood', 
        docNumber: 'WOOD123456789GB',
        docExpiry: '2030-01-01',
        docDob: '1990-01-01',
        docIssuingCountry: 'GB',
        docNationality: 'GB',
        address: '123 Test Street, Test City, TE1 2ST',
        manualAddress: '123 Test Street, Test City, TE1 2ST'
      },
      platform: 'PC',
      startedUtc: new Date().toISOString(),
      finishedUtc: new Date().toISOString()
    };

    try {
      const webhookResponse = await fetch(`${process.env.URL}/.netlify/functions/idenfy-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(minimalWebhookData)
      });

      const webhookText = await webhookResponse.text();
      console.log('📝 Raw webhook response:', webhookText);
      
      let webhookResult;
      try {
        webhookResult = JSON.parse(webhookText);
      } catch (parseError) {
        webhookResult = { 
          error: 'Failed to parse JSON response', 
          rawResponse: webhookText,
          parseError: parseError.message 
        };
      }

      results.step2_webhookCall = {
        success: webhookResponse.ok,
        statusCode: webhookResponse.status,
        result: webhookResult,
        rawResponse: webhookText
      };

      if (webhookResponse.ok) {
        console.log('✅ STEP 2 SUCCESS: Webhook processed:', webhookResult);
        results.success = true;
      } else {
        console.log('❌ STEP 2 FAILED: Webhook error:', webhookResult);
      }

    } catch (webhookError) {
      results.step2_webhookCall = {
        success: false,
        error: webhookError.message
      };
      console.log('❌ STEP 2 FAILED: Webhook call error:', webhookError.message);
    }

    // STEP 3: If webhook failed, try to get more details
    if (!results.step2_webhookCall?.success) {
      console.log('🔍 STEP 3: Analyzing webhook failure...');
      
      results.step3_detailedError = {
        mondayWorking: results.step1_mondayTest?.success || false,
        webhookResponse: results.step2_webhookCall?.rawResponse || 'No response',
        possibleIssues: [
          'Webhook function syntax error',
          'Missing environment variables', 
          'Monday.com API rate limiting',
          'Invalid client ID parsing',
          'Missing function dependencies'
        ]
      };
    }

    // STEP 4: Success path - show next steps
    if (results.success && results.step2_webhookCall?.result?.nextStep) {
      console.log('🚀 SUCCESS: Next step is:', results.step2_webhookCall.result.nextStep);
      
      if (results.step2_webhookCall.result.nextStep === 'dvla_check_required') {
        console.log('📋 UK driver detected - would redirect to DVLA check page');
        console.log('🔗 Missing page: We need to build the DVLA upload page!');
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: results.success,
        testParameters: { testEmail, testJobId },
        stepResults: results,
        nextActions: results.success ? 
          ['Webhook working!', 'Build DVLA upload page', 'Test full flow'] :
          ['Fix webhook errors', 'Check Monday.com integration', 'Review logs']
      }, null, 2)
    };

  } catch (error) {
    console.error('🚨 OVERALL TEST ERROR:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
        testParameters: { testEmail, testJobId },
        stepResults: results
      }, null, 2)
    };
  }
};
