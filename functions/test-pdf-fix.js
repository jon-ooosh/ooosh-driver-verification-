// File: functions/test-pdf-fix.js
// Quick test - try the simpler AWS Textract API for PDF processing
// This API is more compatible with different PDF formats

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Testing simple PDF fix with DetectDocumentText API');
  
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
    const { imageData, fileType } = JSON.parse(event.body);
    
    console.log(`Testing ${fileType} with DetectDocumentText API`);
    
    // Test both the old API (AnalyzeDocument) and new API (DetectDocumentText)
    const results = {};
    
    // Test 1: Original API (should fail for PDF)
    try {
      console.log('🔄 Testing AnalyzeDocument API (current approach)...');
      const analyzeResult = await testAnalyzeDocument(imageData);
      results.analyzeDocument = { success: true, ...analyzeResult };
      console.log('✅ AnalyzeDocument worked');
    } catch (error) {
      results.analyzeDocument = { success: false, error: error.message };
      console.log('❌ AnalyzeDocument failed:', error.message);
    }
    
    // Test 2: Simpler API (more likely to work with PDFs)
    try {
      console.log('🔄 Testing DetectDocumentText API (simpler approach)...');
      const detectResult = await testDetectDocumentText(imageData);
      results.detectDocumentText = { success: true, ...detectResult };
      console.log('✅ DetectDocumentText worked');
    } catch (error) {
      results.detectDocumentText = { success: false, error: error.message };
      console.log('❌ DetectDocumentText failed:', error.message);
    }
    
    // Test 3: Text-only AnalyzeDocument (no FORMS/TABLES features)
    try {
      console.log('🔄 Testing AnalyzeDocument with text-only...');
      const textOnlyResult = await testAnalyzeDocumentTextOnly(imageData);
      results.analyzeDocumentTextOnly = { success: true, ...textOnlyResult };
      console.log('✅ AnalyzeDocument (text-only) worked');
    } catch (error) {
      results.analyzeDocumentTextOnly = { success: false, error: error.message };
      console.log('❌ AnalyzeDocument (text-only) failed:', error.message);
    }
    
    // Determine best approach
    const workingApproaches = Object.entries(results).filter(([key, result]) => result.success);
    const bestApproach = workingApproaches.length > 0 ? workingApproaches[0] : null;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: workingApproaches.length > 0,
        fileType: fileType,
        results: results,
        recommendation: bestApproach ? {
          approach: bestApproach[0],
          textExtracted: bestApproach[1].textLength || 0,
          confidence: bestApproach[1].confidence || 0
        } : null,
        summary: workingApproaches.length > 0 ? 
          `Found ${workingApproaches.length} working approach(es) for ${fileType}` :
          `No approaches worked for ${fileType}`,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('PDF fix test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Test failed',
        details: error.message 
      })
    };
  }
};

// Test current approach (AnalyzeDocument with FORMS/TABLES)
async function testAnalyzeDocument(imageData) {
  const region = process.env.OOOSH_AWS_REGION || 'eu-west-2';
  const endpoint = `https://textract.${region}.amazonaws.com/`;
  const cleanBase64 = imageData.replace(/^data:[^;]+;base64,/, '');
  
  const requestBody = JSON.stringify({
    Document: { Bytes: cleanBase64 },
    FeatureTypes: ['FORMS', 'TABLES']
  });
  
  const signature = await createAwsSignature('POST', 'Textract.AnalyzeDocument', requestBody, region);
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'Textract.AnalyzeDocument',
      'Authorization': signature.authHeader,
      'X-Amz-Date': signature.timestamp,
      'X-Amz-Content-Sha256': signature.contentHash
    },
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AnalyzeDocument failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const text = extractTextFromResponse(result);
  
  return {
    textLength: text.length,
    confidence: calculateConfidence(result),
    sampleText: text.substring(0, 200) + (text.length > 200 ? '...' : '')
  };
}

// Test simpler approach (DetectDocumentText - text only)
async function testDetectDocumentText(imageData) {
  const region = process.env.OOOSH_AWS_REGION || 'eu-west-2';
  const endpoint = `https://textract.${region}.amazonaws.com/`;
  const cleanBase64 = imageData.replace(/^data:[^;]+;base64,/, '');
  
  const requestBody = JSON.stringify({
    Document: { Bytes: cleanBase64 }
    // No FeatureTypes - just basic text detection
  });
  
  const signature = await createAwsSignature('POST', 'Textract.DetectDocumentText', requestBody, region);
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'Textract.DetectDocumentText',
      'Authorization': signature.authHeader,
      'X-Amz-Date': signature.timestamp,
      'X-Amz-Content-Sha256': signature.contentHash
    },
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DetectDocumentText failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const text = extractTextFromResponse(result);
  
  return {
    textLength: text.length,
    confidence: calculateConfidence(result),
    sampleText: text.substring(0, 200) + (text.length > 200 ? '...' : '')
  };
}

// Test AnalyzeDocument without advanced features
async function testAnalyzeDocumentTextOnly(imageData) {
  const region = process.env.OOOSH_AWS_REGION || 'eu-west-2';
  const endpoint = `https://textract.${region}.amazonaws.com/`;
  const cleanBase64 = imageData.replace(/^data:[^;]+;base64,/, '');
  
  const requestBody = JSON.stringify({
    Document: { Bytes: cleanBase64 }
    // No FeatureTypes - basic text detection within AnalyzeDocument
  });
  
  const signature = await createAwsSignature('POST', 'Textract.AnalyzeDocument', requestBody, region);
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'Textract.AnalyzeDocument',
      'Authorization': signature.authHeader,
      'X-Amz-Date': signature.timestamp,
      'X-Amz-Content-Sha256': signature.contentHash
    },
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AnalyzeDocument (text-only) failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const text = extractTextFromResponse(result);
  
  return {
    textLength: text.length,
    confidence: calculateConfidence(result),
    sampleText: text.substring(0, 200) + (text.length > 200 ? '...' : '')
  };
}

// Extract text from Textract response
function extractTextFromResponse(response) {
  if (!response.Blocks) return '';
  
  return response.Blocks
    .filter(block => block.BlockType === 'LINE')
    .map(block => block.Text)
    .join('\n');
}

// Calculate confidence
function calculateConfidence(response) {
  if (!response.Blocks) return 0;
  
  const confidences = response.Blocks
    .filter(block => block.Confidence)
    .map(block => block.Confidence);
    
  return confidences.length > 0 ? 
    Math.round(confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length) : 0;
}

// Create AWS signature
async function createAwsSignature(method, target, body, region) {
  const crypto = require('crypto');
  
  const accessKeyId = process.env.OOOSH_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OOOSH_AWS_SECRET_ACCESS_KEY;
  const service = 'textract';
  
  const timestamp = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '');
  const date = timestamp.substr(0, 8);
  const contentHash = crypto.createHash('sha256').update(body).digest('hex');
  
  const canonicalRequest = [
    method, '/', '',
    'content-type:application/x-amz-json-1.1',
    `host:textract.${region}.amazonaws.com`,
    `x-amz-content-sha256:${contentHash}`,
    `x-amz-date:${timestamp}`,
    `x-amz-target:${target}`,
    '',
    'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target',
    contentHash
  ].join('\n');
  
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', timestamp, credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  
  const signingKey = getSignatureKey(secretAccessKey, date, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  
  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target, Signature=${signature}`;
  
  return { authHeader, timestamp, contentHash };
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const crypto = require('crypto');
  const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
  return crypto.createHmac('sha256', kService).update('aws4_request').digest();
}
