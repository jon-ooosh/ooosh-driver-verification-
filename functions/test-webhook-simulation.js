// functions/test-webhook-simulation.js
// Enhanced webhook simulator with real PDF test files

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }

  const { email = 'test@example.com', jobId = '99999', type = 'full' } = event.queryStringParameters || {};

  try {
    console.log('🧪 Enhanced webhook simulation starting...', { email, jobId, type });

    // Create test PDFs as base64 (simple but valid PDFs)
    const testPdfBase64 = "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDYxMiA3OTJdL1BhcmVudCAyIDAgUi9SZXNvdXJjZXM8PC9Gb250PDwvRjE8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+Pj4+Pj4vQ29udGVudHMgNCAwIFI+PgplbmRvYmoKNCAwIG9iago8PC9MZW5ndGggNDQ+PgpzdHJlYW0KQlQKL0YxIDEyIFRmCjcyIDcxMiBUZAooVGVzdCBQREYgRG9jdW1lbnQpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKMDAwMDAwMDEyNSAwMDAwMCBuIAowMDAwMDAwMjczIDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA1L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMzY2CiUlRU9G";

    // Create a simple test PNG as base64 (1x1 red pixel)
    const testPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

    // Determine which files to include based on type
    let fileUrls = {};
    if (type === 'full' || type === 'license_only') {
      // Use PNG for license (these usually work fine)
      fileUrls.FRONT = `data:image/png;base64,${testPngBase64}`;
      fileUrls.BACK = `data:image/png;base64,${testPngBase64}`;
    }
    if (type === 'full' || type === 'poa_both' || type === 'poa1') {
      // Use PDF for POAs (to test the PDF handling)
      fileUrls.UTILITY_BILL = `data:application/pdf;base64,${testPdfBase64}`;
    }
    if (type === 'full' || type === 'poa_both' || type === 'poa2') {
      fileUrls.POA2 = `data:application/pdf;base64,${testPdfBase64}`;
    }

    // Build the webhook payload
    const webhookData = {
      clientId: `job_${jobId}_${email}`,
      scanRef: `TEST-${Date.now()}`,
      status: {
        overall: "APPROVED",
        suspicionReasons: [],
        autoDocument: "DOC_VALIDATED",
        autoFace: "FACE_MATCH",
        manualDocument: null,
        manualFace: null
      },
      data: {
        docFirstName: "JOHN",
        docLastName: "TESTDRIVER",
        docNumber: "TEST99901019JT9AA",
        docExpiry: "2030-01-01",
        docDob: "1990-01-01", 
        docType: "DRIVING_LICENSE",
        docSex: "MALE",
        docNationality: "GB",  // UK driver for testing
        docIssuingCountry: "GB",
        authority: "DVLA",
        driverLicenseCategory: "B, BE",
        fullName: "JOHN TESTDRIVER",
        address: "123 Test Street, London, UK"
      },
      fileUrls: fileUrls,
      approved: true,
      idenfyResult: {
        status: "APPROVED",
        data: {
          docIssuingCountry: "GB"
        }
      }
    };

    console.log('📡 Calling webhook with test data (includes PDFs for POAs)...');

    // Call the actual webhook
    const webhookUrl = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/idenfy-webhook`;
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookData)
    });

    const webhookResult = await webhookResponse.json();
    console.log('🎯 Webhook response:', webhookResult);

    // Determine next step based on result
    let nextUrl = `${process.env.URL || 'http://localhost:8888'}`;
    let message = '';

    if (webhookResult.ukDriver) {
      nextUrl += `/?step=dvla-processing&email=${encodeURIComponent(email)}&uk=true&job=${jobId}`;
      message = '🇬🇧 UK driver detected - should route to DVLA check';
    } else {
      nextUrl += `/?step=complete&email=${encodeURIComponent(email)}&job=${jobId}`;
      message = '🌍 Non-UK driver - should route to completion';
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `✅ Test webhook simulation complete! ${message}`,
        webhookResult: webhookResult,
        nextStepUrl: nextUrl,
        testData: {
          email: email,
          jobId: jobId,
          nationality: 'GB',
          filesIncluded: Object.keys(fileUrls),
          pdfFilesIncluded: Object.keys(fileUrls).filter(k => k.includes('UTILITY') || k.includes('POA'))
        }
      })
    };

  } catch (error) {
    console.error('❌ Test simulation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      })
    };
  }
};
