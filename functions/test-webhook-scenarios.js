// Test webhook simulator for different scenarios
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Get scenario from query params
  const scenario = event.queryStringParameters?.scenario || 'uk-driver-valid-poas';
  const email = event.queryStringParameters?.email || `test${Date.now()}@oooshtours.co.uk`;
  
  console.log(`🧪 Running test scenario: ${scenario} for ${email}`);

  // Base webhook data
  const baseWebhookData = {
    final: true,
    platform: "MOBILE",
    scanRef: `test-${Date.now()}-${scenario}`,
    clientId: `ooosh_99999_${email.replace('@', '_at_').replace(/\./g, '_dot_')}_${Date.now()}`,
    status: {
      overall: "APPROVED",
      autoDocument: "DOC_VALIDATED",
      manualDocument: "DOC_VALIDATED",
      autoFace: "FACE_MATCH",
      manualFace: "FACE_MATCH",
      additionalSteps: "VALID"
    }
  };

  let webhookData = { ...baseWebhookData };

  // Customize based on scenario
  switch (scenario) {
    case 'uk-driver-valid-poas':
      webhookData.data = {
        docFirstName: "TEST",
        docLastName: "DRIVER",
        docNumber: "TEST9801093JM9PX",
        docExpiry: "2029-12-29",
        docDob: "1990-01-01",
        docIssuingCountry: "GB",
        authority: "DVLA",
        docNationality: "GB"
      };
      // Add test POA URLs (you'll need to use real test files)
      webhookData.additionalStepPdfUrls = {
        UTILITY_BILL: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        POA2: "https://www.africau.edu/images/default/sample.pdf"
      };
      break;

    case 'uk-driver-duplicate-poas':
      webhookData.data = {
        docFirstName: "TEST",
        docLastName: "DUPLICATE",
        docIssuingCountry: "GB",
        authority: "DVLA"
      };
      // Same URL twice to trigger duplicate
      webhookData.additionalStepPdfUrls = {
        UTILITY_BILL: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        POA2: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
      };
      break;

    case 'non-uk-driver':
      webhookData.data = {
        docFirstName: "FOREIGN",
        docLastName: "DRIVER",
        docIssuingCountry: "US",
        authority: "DMV",
        docNationality: "US"
      };
      break;

    case 'uk-driver-no-poas':
      webhookData.data = {
        docFirstName: "NO",
        docLastName: "POAS",
        docIssuingCountry: "GB",
        authority: "DVLA"
      };
      // No POA URLs
      break;

    case 'verification-failed':
      webhookData.status.overall = "DENIED";
      webhookData.status.autoDocument = "DOC_NOT_VALIDATED";
      break;

      case 'check-monday-data':
  // Just check what's in Monday for a given email
  const checkResponse = await fetch(`${process.env.URL}/.netlify/functions/driver-status?email=${email}`);
  const driverData = await checkResponse.json();
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      scenario: 'check-monday-data',
      email: email,
      mondayData: driverData
    })
  };

    default:
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Unknown scenario',
          availableScenarios: [
            'uk-driver-valid-poas',
            'uk-driver-duplicate-poas',
            'non-uk-driver',
            'uk-driver-no-poas',
            'verification-failed'
          ]
        })
      };
  }

  // Call the actual webhook
  try {
    const response = await fetch(`${process.env.URL}/.netlify/functions/idenfy-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookData)
    });

    const result = await response.json();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        scenario: scenario,
        email: email,
        webhookResponse: result,
        testData: webhookData
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
