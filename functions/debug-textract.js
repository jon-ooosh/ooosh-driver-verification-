// File: functions/debug-textract.js
// AWS Textract Debug Function - Diagnose PDF processing issues
// Add this as a new Netlify function to debug the textract integration

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('AWS Textract Debug function called');
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { imageData, fileType, fileName } = JSON.parse(event.body);
    
    console.log('Debug input:', { 
      hasImageData: !!imageData, 
      fileType, 
      fileName,
      imageSizeApprox: imageData ? Math.round((imageData.length * 3) / 4 / 1024) + 'KB' : 'N/A'
    });

    const debugInfo = {
      environment: {
        hasAwsCredentials: !!(process.env.OOOSH_AWS_ACCESS_KEY_ID && process.env.OOOSH_AWS_SECRET_ACCESS_KEY),
        awsRegion: process.env.OOOSH_AWS_REGION || 'eu-west-2',
        nodeVersion: process.version
      },
      input: {
        fileType: fileType,
        fileName: fileName,
        imageDataLength: imageData ? imageData.length : 0,
        estimatedSizeKB: imageData ? Math.round((imageData.length * 3) / 4 / 1024) : 0,
        startsWithDataUrl: imageData ? imageData.startsWith('data:') : false,
        base64Sample: imageData ? imageData.substring(0, 50) + '...' : 'No data'
      },
      tests: {}
    };

    if (!imageData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'No imageData provided',
          debugInfo
        })
      };
    }

    // Test 1: Clean base64 and validate
    const cleanBase64 = imageData.replace(/^data:.*?;base64,/, '');
    debugInfo.tests.base64Cleaning = {
      originalLength: imageData.length,
      cleanedLength: cleanBase64.length,
      removedPrefix: imageData.length !== cleanBase64.length,
      isValidBase64: isValidBase64(cleanBase64)
    };

    // Test 2: Check file size limits
    const fileSizeBytes = Math.round((cleanBase64.length * 3) / 4);
    debugInfo.tests.fileSize = {
      sizeBytes: fileSizeBytes,
      sizeKB: Math.round(fileSizeBytes / 1024),
      withinLimit: fileSizeBytes <= 10000000, // 10MB AWS limit
      limit: '10MB'
    };

    // Test 3: Try to detect actual file type from base64
    const detectedType = detectFileTypeFromBase64(cleanBase64);
    debugInfo.tests.fileTypeDetection = {
      providedType: fileType,
      detectedType: detectedType,
      mismatch: fileType !== detectedType
    };

    // Test 4: If we have AWS credentials, try a minimal Textract call
    if (debugInfo.environment.hasAwsCredentials) {
      try {
        console.log('Testing AWS Textract connection...');
        const textractResult = await testTextractConnection(cleanBase64);
        debugInfo.tests.textractConnection = {
          success: textractResult.success,
          error: textractResult.error || null,
          response: textractResult.response || null
        };
      } catch (error) {
        debugInfo.tests.textractConnection = {
          success: false,
          error: error.message,
          response: null
        };
      }
    } else {
      debugInfo.tests.textractConnection = {
        skipped: 'No AWS credentials configured'
      };
    }

    // Recommendations based on test results
    const recommendations = generateRecommendations(debugInfo);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        debugInfo,
        recommendations,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Debug function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Debug function failed',
        details: error.message,
        stack: error.stack 
      })
    };
  }
};

// Validate base64 string
function isValidBase64(str) {
  try {
    // Check if it's valid base64
    const decoded = Buffer.from(str, 'base64');
    const reencoded = decoded.toString('base64');
    return reencoded === str && str.length > 0;
  } catch (error) {
    return false;
  }
}

// Detect file type from base64 magic numbers
function detectFileTypeFromBase64(base64String) {
  try {
    const buffer = Buffer.from(base64String.substring(0, 20), 'base64');
    const hex = buffer.toString('hex').toUpperCase();
    
    // Check magic numbers
    if (hex.startsWith('FFD8FF')) return 'jpeg';
    if (hex.startsWith('89504E47')) return 'png';
    if (hex.startsWith('47494638')) return 'gif';
    if (hex.startsWith('25504446')) return 'pdf';
    if (hex.startsWith('49492A00') || hex.startsWith('4D4D002A')) return 'tiff';
    
    return 'unknown';
  } catch (error) {
    return 'error';
  }
}

// Test AWS Textract connection with minimal request
async function testTextractConnection(base64Data) {
  try {
    const region = process.env.OOOSH_AWS_REGION || 'eu-west-2';
    const endpoint = `https://textract.${region}.amazonaws.com/`;
    
    // Create minimal test request
    const requestBody = JSON.stringify({
      Document: {
        Bytes: base64Data.substring(0, 1000) // Use just first part for connection test
      },
      FeatureTypes: ['FORMS']
    });
    
    // Create AWS signature
    const signature = await createAwsSignature('POST', endpoint, requestBody, region);
    
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

    const responseText = await response.text();
    
    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      error: response.ok ? null : responseText,
      response: response.ok ? 'Connection successful' : null
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      response: null
    };
  }
}

// AWS Signature creation (copied from your existing code)
async function createAwsSignature(method, endpoint, body, region) {
  const crypto = require('crypto');
  
  const accessKeyId = process.env.OOOSH_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OOOSH_AWS_SECRET_ACCESS_KEY;
  const service = 'textract';
  
  const timestamp = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '');
  const date = timestamp.substr(0, 8);
  
  // Create content hash
  const contentHash = crypto.createHash('sha256').update(body).digest('hex');
  
  // Create canonical request
  const canonicalRequest = [
    method,
    '/',
    '',
    'content-type:application/x-amz-json-1.1',
    `host:textract.${region}.amazonaws.com`,
    `x-amz-content-sha256:${contentHash}`,
    `x-amz-date:${timestamp}`,
    `x-amz-target:Textract.AnalyzeDocument`,
    '',
    'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target',
    contentHash
  ].join('\n');
  
  // Create string to sign
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  
  // Calculate signature
  const signingKey = getSignatureKey(secretAccessKey, date, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  
  // Create authorization header
  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target, Signature=${signature}`;
  
  return {
    authHeader: authHeader,
    timestamp: timestamp,
    contentHash: contentHash
  };
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const crypto = require('crypto');
  const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  return kSigning;
}

// Generate recommendations based on debug results
function generateRecommendations(debugInfo) {
  const recommendations = [];
  
  if (!debugInfo.environment.hasAwsCredentials) {
    recommendations.push({
      priority: 'HIGH',
      issue: 'Missing AWS credentials',
      action: 'Configure OOOSH_AWS_ACCESS_KEY_ID and OOOSH_AWS_SECRET_ACCESS_KEY environment variables'
    });
  }
  
  if (!debugInfo.tests.base64Cleaning.isValidBase64) {
    recommendations.push({
      priority: 'HIGH',
      issue: 'Invalid base64 data',
      action: 'Check file upload and base64 conversion process'
    });
  }
  
  if (!debugInfo.tests.fileSize.withinLimit) {
    recommendations.push({
      priority: 'HIGH',
      issue: 'File size exceeds AWS Textract limit',
      action: 'Implement file compression or resize before processing'
    });
  }
  
  if (debugInfo.tests.fileTypeDetection.mismatch) {
    recommendations.push({
      priority: 'MEDIUM',
      issue: 'File type mismatch detected',
      action: `Provided: ${debugInfo.tests.fileTypeDetection.providedType}, Detected: ${debugInfo.tests.fileTypeDetection.detectedType}`
    });
  }
  
  if (debugInfo.tests.textractConnection && !debugInfo.tests.textractConnection.success) {
    recommendations.push({
      priority: 'HIGH',
      issue: 'AWS Textract connection failed',
      action: 'Check AWS credentials, permissions, and network connectivity',
      details: debugInfo.tests.textractConnection.error
    });
  }
  
  return recommendations;
}
