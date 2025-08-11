// File: functions/test-claude-ocr.js
// SESSION 18 WORKING VERSION + License Ending Only
// Stop overthinking - just add license ending to what was working!

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('AWS Textract OCR Test - Session 18 + License Ending');
  
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
    const { testType, imageData, documentType, licenseAddress, fileType, imageData2 } = JSON.parse(event.body);
    
    if (!testType || !imageData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'testType and imageData are required'
        })
      };
    }

    console.log(`Testing ${testType} OCR processing with AWS Textract`);
    let result;

    switch (testType) {
      case 'dvla':
        result = await testDvlaExtractionWithTextract(imageData, fileType);
        break;
      case 'poa':
        result = await testSinglePoaExtraction(imageData, documentType, licenseAddress, fileType);
        break;
      case 'dual-poa':
        if (!imageData2) {
          throw new Error('dual-poa test requires both imageData and imageData2');
        }
        result = await testDualPoaCrossValidation(imageData, imageData2, licenseAddress, fileType);
        break;
      default:
        throw new Error('Invalid testType');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        testType: testType,
        result: result,
        ocrProvider: 'AWS Textract',
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('AWS Textract OCR test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'AWS Textract OCR test failed',
        details: error.message 
      })
    };
  }
};

// DVLA processing - Session 18 working version + license ending
async function testDvlaExtractionWithTextract(imageData, fileType = 'image') {
  console.log('🚗 DVLA OCR with AWS Textract - Session 18 + License Ending');
  
  if (!process.env.OOOSH_AWS_ACCESS_KEY_ID || !process.env.OOOSH_AWS_SECRET_ACCESS_KEY) {
    console.log('⚠️ AWS credentials not configured');
    throw new Error('AWS Textract credentials not configured');
  }

  try {
    // Call AWS Textract
    const textractResult = await callAwsTextract(imageData, fileType);
    
    // Parse DVLA data - Session 18 logic + license ending
    const dvlaData = parseDvlaFromText(textractResult.extractedText);
    
    // Validate data
    const validatedData = validateDvlaData(dvlaData);
    
    console.log('✅ DVLA analysis completed successfully');
    return validatedData;

  } catch (error) {
    console.error('DVLA processing error:', error);
    throw error; // Let the main handler deal with errors
  }
}

// Session 18 WORKING parsing logic + license ending extraction
function parseDvlaFromText(text) {
  console.log('🔍 DVLA parsing - Session 18 + License Ending');
  
  const dvlaData = {
    licenseNumber: null,
    licenseEnding: null, // NEW: For anti-fraud validation
    driverName: null,
    checkCode: null,
    dateGenerated: null,
    validFrom: null,
    validTo: null,
    drivingStatus: null,
    endorsements: [],
    totalPoints: 0,
    restrictions: [],
    categories: [],
    isValid: true,
    issues: [],
    confidence: 'high'
  };

  // Extract license number (Session 18 working logic)
  const licenseMatch = text.match(/([A-Z]{2,5}[0-9]{6}[A-Z0-9]{2}[A-Z]{2})/);
  if (licenseMatch) {
    dvlaData.licenseNumber = licenseMatch[1];
    dvlaData.licenseEnding = licenseMatch[1].slice(-8); // NEW: Last 8 characters
    console.log('✅ Full license found:', dvlaData.licenseNumber);
    console.log('✅ License ending:', dvlaData.licenseEnding);
  }

  // NEW: Backup license ending extraction from partial format
  if (!dvlaData.licenseEnding) {
    const partialMatch = text.match(/(XXXXXXXX[A-Z0-9]{2}[A-Z]{2})/);
    if (partialMatch) {
      dvlaData.licenseEnding = partialMatch[1].replace('XXXXXXXX', '');
      console.log('✅ License ending from partial:', dvlaData.licenseEnding);
    }
  }

  // Extract driver name (Session 18 logic)
  const namePatterns = [
    /Name[:\s]+([A-Z][A-Z\s]+[A-Z])/,
    /([A-Z]{2,}\s+[A-Z]{2,}(?:\s+[A-Z]{2,})?)/
  ];
  
  for (const pattern of namePatterns) {
    const nameMatch = text.match(pattern);
    if (nameMatch && nameMatch[1] && nameMatch[1].length > 5 && nameMatch[1].length < 50) {
      dvlaData.driverName = nameMatch[1].trim();
      console.log('✅ Found driver name:', dvlaData.driverName);
      break;
    }
  }

  // Extract check code (Session 18 logic)
  const checkCodeMatch = text.match(/([A-Za-z]{1,2}\s+[A-Za-z0-9]{1,2}\s+[A-Za-z0-9]{1,2}\s+[A-Za-z0-9]{1,2})/);
  if (checkCodeMatch) {
    dvlaData.checkCode = checkCodeMatch[1];
    console.log('✅ Found check code:', dvlaData.checkCode);
  }

  // Extract dates (Session 18 SIMPLE logic - no complex forEach)
  console.log('📅 Extracting dates...');
  
  // UK long format first
  const ukDateMatch = text.match(/Date\s+summary\s+generated\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  if (ukDateMatch) {
    dvlaData.dateGenerated = standardizeDate(ukDateMatch[1]);
    console.log('✅ Found UK date:', dvlaData.dateGenerated);
  }
  
  // Backup: standard date formats
  if (!dvlaData.dateGenerated) {
    const dateMatch = text.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/);
    if (dateMatch) {
      dvlaData.dateGenerated = standardizeDate(dateMatch[1]);
      console.log('✅ Found standard date:', dvlaData.dateGenerated);
    }
  }

  // Extract total points (Session 18 logic)
  const pointsMatch = text.match(/(?:total|penalty)?\s*points?[:\s]*(\d+)/i);
  if (pointsMatch) {
    dvlaData.totalPoints = parseInt(pointsMatch[1]);
    console.log('✅ Found total points:', dvlaData.totalPoints);
  }

  // Session 18 WORKING endorsement extraction (no complex deduplication)
  const endorsementPattern = /([A-Z]{2}[0-9]{2})/g;
  const endorsementMatches = text.match(endorsementPattern) || [];
  
  endorsementMatches.forEach(code => {
    if (['SP', 'MS', 'CU', 'IN', 'DR', 'BA', 'DD', 'UT', 'TT'].some(prefix => code.startsWith(prefix))) {
      dvlaData.endorsements.push({
        code: code,
        date: dvlaData.dateGenerated || new Date().toISOString().split('T')[0],
        points: getPointsForEndorsement(code),
        description: getEndorsementDescription(code)
      });
    }
  });

  // Extract license categories (Session 18 logic)
  const categoryMatch = text.match(/categories?[:\s]*([A-Z0-9\s,+]+)/i);
  if (categoryMatch) {
    dvlaData.categories = categoryMatch[1].split(/[,\s+]/).filter(c => c.length > 0);
  }

  // Check for driving status
  if (text.toLowerCase().includes('current') && text.toLowerCase().includes('licence')) {
    dvlaData.drivingStatus = 'Current full licence';
  }

  return dvlaData;
}

// Session 18 validation logic
function validateDvlaData(dvlaData) {
  console.log('🔍 Validating DVLA data...');
  
  if (!dvlaData.driverName) {
    dvlaData.issues.push('❌ Driver name not found');
    dvlaData.isValid = false;
    dvlaData.confidence = 'low';
  }
  
  if (!dvlaData.checkCode) {
    dvlaData.issues.push('⚠️ DVLA check code not found');
  }
  
  // Check if check is recent (within 30 days)
  if (dvlaData.dateGenerated) {
    const checkAge = calculateDaysFromDate(dvlaData.dateGenerated);
    dvlaData.ageInDays = checkAge;
    
    if (checkAge > 30) {
      dvlaData.issues.push('⚠️ DVLA check is older than 30 days');
    }
  }
  
  // Calculate insurance decision (Session 18 logic)
  dvlaData.insuranceDecision = calculateInsuranceDecision(dvlaData);
  dvlaData.extractionSuccess = dvlaData.isValid;
  
  console.log(`🚗 DVLA validation complete: ${dvlaData.issues.length} issues, ${dvlaData.totalPoints} points`);
  return dvlaData;
}

// Session 18 insurance decision (WORKING)
function calculateInsuranceDecision(dvlaData) {
  const decision = {
    approved: false,
    excess: 0,
    manualReview: false,
    reasons: [],
    riskLevel: 'standard'
  };

  if (!dvlaData.isValid) {
    decision.manualReview = true;
    decision.reasons.push('DVLA check could not be validated');
    return decision;
  }

  const points = dvlaData.totalPoints || 0;
  const endorsements = dvlaData.endorsements || [];

  // Check for serious offenses
  const seriousOffenses = ['MS90', 'IN10', 'DR10', 'DR20', 'DR30', 'DR40', 'DR50', 'DR60', 'DR70'];
  const hasSeriousOffense = endorsements.some(e => seriousOffenses.includes(e.code));

  if (hasSeriousOffense) {
    decision.manualReview = true;
    decision.reasons.push('Serious driving offense detected - requires underwriter review');
    return decision;
  }

  // Points-based logic (Session 18)
  if (points === 0) {
    decision.approved = true;
    decision.riskLevel = 'low';
    decision.reasons.push('Clean license - no points');
  } else if (points <= 3) {
    decision.approved = true;
    decision.riskLevel = 'standard';
    decision.reasons.push('Minor points - standard approval');
  } else if (points <= 6) {
    const hasSpeedingOnly = endorsements.every(e => e.code && e.code.startsWith('SP'));
    if (hasSpeedingOnly) {
      decision.approved = true;
      decision.riskLevel = 'medium';
      decision.reasons.push('Speeding points only - approved');
    } else {
      decision.manualReview = true;
      decision.reasons.push('Mixed offenses with 4-6 points - requires review');
    }
  } else if (points <= 9) {
    decision.approved = true;
    decision.excess = 500;
    decision.riskLevel = 'high';
    decision.reasons.push('7-9 points - approved with £500 excess');
  } else {
    decision.approved = false;
    decision.reasons.push('10+ points - exceeds insurance limits');
  }

  return decision;
}

// Helper functions (Session 18 versions)
function standardizeDate(dateStr) {
  try {
    // Handle UK long format: "15 July 2025"
    if (/\d{1,2}\s+[A-Za-z]+\s+\d{4}/.test(dateStr)) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
    
    // Handle other formats
    const date = new Date(dateStr.replace(/[\/\.]/g, '-'));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    console.warn('Could not parse date:', dateStr);
  }
  return dateStr;
}

function calculateDaysFromDate(dateString) {
  try {
    const parsedDate = new Date(dateString);
    if (isNaN(parsedDate.getTime())) return 999;
    
    const today = new Date();
    const diffTime = today.getTime() - parsedDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  } catch (error) {
    return 999;
  }
}

function getPointsForEndorsement(code) {
  const pointsMap = {
    'SP30': 3, 'SP50': 3, 'MS90': 6, 'CU80': 3, 'IN10': 6
  };
  return pointsMap[code] || 3;
}

function getEndorsementDescription(code) {
  const descriptions = {
    'SP30': 'Exceeding statutory speed limit on a public road',
    'SP50': 'Exceeding speed limit on a motorway',
    'MS90': 'Failure to give information as to identity of driver',
    'CU80': 'Breach of requirements as to control of the vehicle',
    'IN10': 'Using a vehicle uninsured against third party risks'
  };
  return descriptions[code] || 'Traffic offence';
}

// AWS Textract call (unchanged from Session 18)
async function callAwsTextract(imageData, fileType) {
  console.log('📞 Calling AWS Textract API...');
  
  const region = process.env.OOOSH_AWS_REGION || 'eu-west-2';
  const endpoint = `https://textract.${region}.amazonaws.com/`;
  
  const imageSizeBytes = (imageData.length * 3) / 4;
  console.log(`📏 Image size: ${Math.round(imageSizeBytes / 1024)}KB`);
  
  if (imageSizeBytes > 10000000) {
    throw new Error('Image too large for AWS Textract (max 10MB)');
  }
  
  const cleanBase64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
  
  const requestBody = JSON.stringify({
    Document: { Bytes: cleanBase64 }
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
    throw new Error(`AWS Textract error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const extractedText = extractTextFromTextractResponse(result);
  
  return {
    extractedText: extractedText,
    confidence: calculateAverageConfidence(result)
  };
}

function extractTextFromTextractResponse(textractResponse) {
  if (!textractResponse.Blocks) return '';
  
  const textBlocks = textractResponse.Blocks
    .filter(block => block.BlockType === 'LINE')
    .map(block => block.Text)
    .join('\n');
    
  console.log('📝 Extracted text length:', textBlocks.length);
  return textBlocks;
}

function calculateAverageConfidence(textractResponse) {
  if (!textractResponse.Blocks || textractResponse.Blocks.length === 0) return 0;
  
  const confidences = textractResponse.Blocks
    .filter(block => block.Confidence)
    .map(block => block.Confidence);
    
  if (confidences.length === 0) return 0;
  
  const avgConfidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
  return Math.round(avgConfidence);
}

// AWS signature creation (unchanged)
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

// POA functions (simple versions)
async function testSinglePoaExtraction(imageData, documentType, licenseAddress, fileType) {
  return getMockPoaData('Single-POA');
}

async function testDualPoaCrossValidation(imageData1, imageData2, licenseAddress, fileType) {
  const poa1Analysis = getMockPoaData('POA1');
  const poa2Analysis = getMockPoaData('POA2');
  const crossValidation = performPoaCrossValidation(poa1Analysis, poa2Analysis);
  
  return {
    testType: 'dual-poa',
    poa1: poa1Analysis,
    poa2: poa2Analysis,
    crossValidation: crossValidation,
    overallValid: crossValidation.approved
  };
}

function performPoaCrossValidation(poa1, poa2) {
  const validation = {
    approved: false,
    issues: []
  };

  const sameProvider = poa1.providerName?.toLowerCase() === poa2.providerName?.toLowerCase();
  
  if (sameProvider) {
    validation.issues.push(`❌ Both POAs are from the same provider: ${poa1.providerName}`);
  } else {
    validation.issues.push(`✅ Different providers: ${poa1.providerName} vs ${poa2.providerName}`);
    validation.approved = true;
  }

  return validation;
}

function getMockPoaData(documentId) {
  const mockData = {
    POA1: {
      documentType: 'utility_bill',
      providerName: 'British Gas',
      documentDate: '2025-06-15',
      accountNumber: '****1234'
    },
    POA2: {
      documentType: 'bank_statement',
      providerName: 'HSBC Bank',
      documentDate: '2025-06-20',
      accountNumber: '****5678'
    },
    'Single-POA': {
      documentType: 'utility_bill',
      providerName: 'British Gas',
      documentDate: '2025-06-15',
      accountNumber: '****1234'
    }
  };
  return mockData[documentId] || mockData.POA1;
}
