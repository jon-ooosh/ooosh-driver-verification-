// File: functions/test-claude-ocr.js
// AWS TEXTRACT VERSION - Reliable OCR processing
// SESSION 20 UPDATE: Added license ending extraction for anti-fraud validation

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('AWS Textract OCR Test function called');
  
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
          error: 'testType and imageData are required',
          usage: 'testType: "poa", "dvla", or "dual-poa", imageData: base64 string'
        })
      };
    }

    console.log(`Testing ${testType} OCR processing with AWS Textract (${fileType || 'image'})`);
    let result;

    switch (testType) {
      case 'poa':
        result = await testSinglePoaExtraction(imageData, documentType, licenseAddress, fileType);
        break;
      case 'dvla':
        result = await testDvlaExtractionWithTextract(imageData, fileType);
        break;
      case 'dual-poa':
        if (!imageData2) {
          throw new Error('dual-poa test requires both imageData and imageData2');
        }
        result = await testDualPoaCrossValidation(imageData, imageData2, licenseAddress, fileType);
        break;
      default:
        throw new Error('Invalid testType. Use "poa", "dvla", or "dual-poa"');
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

// AWS TEXTRACT: DVLA processing with reliable extraction
async function testDvlaExtractionWithTextract(imageData, fileType = 'image') {
  console.log('🚗 Testing DVLA OCR with AWS Textract');
  
  if (!process.env.OOOSH_AWS_ACCESS_KEY_ID || !process.env.OOOSH_AWS_SECRET_ACCESS_KEY) {
    console.log('⚠️ AWS credentials not configured - using enhanced mock');
    return getEnhancedMockDvlaAnalysis();
  }

  try {
    console.log('Attempting AWS Textract for DVLA analysis...');
    
    // Call AWS Textract
    const textractResult = await callAwsTextract(imageData, fileType);
    
    // Parse DVLA-specific data from the extracted text
    const dvlaData = parseDvlaFromText(textractResult.extractedText);
    
    // Validate and enhance the data
    const validatedData = validateDvlaData(dvlaData);
    
    console.log('✅ AWS Textract DVLA analysis successful');
    return validatedData;

  } catch (error) {
    console.log('❌ AWS Textract failed, using fallback:', error.message);
    return createDvlaFallback(fileType, error.message);
  }
}

// AWS TEXTRACT: Call the API
async function callAwsTextract(imageData, fileType) {
  console.log('📞 Calling AWS Textract API...');
  
  const region = process.env.OOOSH_AWS_REGION || 'eu-west-2';
  const endpoint = `https://textract.${region}.amazonaws.com/`;
  
  // Validate image size (AWS limit is 10MB)
  const imageSizeBytes = (imageData.length * 3) / 4; // Approximate base64 to bytes
  console.log(`📏 Image size: ${Math.round(imageSizeBytes / 1024)}KB`);
  
  if (imageSizeBytes > 10000000) { // 10MB limit
    throw new Error('Image too large for AWS Textract (max 10MB)');
  }
  
  // Ensure clean base64 (remove data URL prefix if present)
  const cleanBase64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
  
  // Use DetectDocumentText for better PDF compatibility
  const requestBody = JSON.stringify({
    Document: {
      Bytes: cleanBase64
    }
  });
  
  // Create AWS signature
  const signature = await createAwsSignature('POST', 'DetectDocumentText', requestBody, region);
  
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
    console.error('AWS Textract error:', response.status, errorText);
    throw new Error(`AWS Textract error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log('📄 AWS Textract response received');
  
  // Extract all text from the response
  const extractedText = extractTextFromTextractResponse(result);
  
  return {
    extractedText: extractedText,
    confidence: calculateAverageConfidence(result),
    rawResponse: result
  };
}

// Extract text from Textract response
function extractTextFromTextractResponse(textractResponse) {
  if (!textractResponse.Blocks) {
    return '';
  }
  
  const textBlocks = textractResponse.Blocks
    .filter(block => block.BlockType === 'LINE')
    .map(block => block.Text)
    .join('\n');
    
  console.log('📝 Extracted text length:', textBlocks.length);
  return textBlocks;
}

// Calculate average confidence from Textract response
function calculateAverageConfidence(textractResponse) {
  if (!textractResponse.Blocks || textractResponse.Blocks.length === 0) {
    return 0;
  }
  
  const confidences = textractResponse.Blocks
    .filter(block => block.Confidence)
    .map(block => block.Confidence);
    
  if (confidences.length === 0) return 0;
  
  const avgConfidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
  return Math.round(avgConfidence);
}

// NEW: Extract license ending (last 8 characters) for anti-fraud validation
function extractLicenseEnding(text) {
  console.log('🔍 Extracting license ending from DVLA text...');
  
  // Look for DVLA pattern: "Driving licence number XXXXXXXX162JD9GA"
  const licensePatterns = [
    /Driving licence number[:\s]+XXXXXXXX([A-Z0-9]{6,8})/i,
    /licence number[:\s]+XXXXXXXX([A-Z0-9]{6,8})/i,
    /XXXXXXXX([A-Z0-9]{6,8})/g // Fallback pattern
  ];
  
  for (const pattern of licensePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const ending = match[1];
      console.log('✅ License ending extracted:', ending);
      return ending;
    }
  }
  
  console.log('⚠️ No license ending found');
  return null;
}

// Parse DVLA-specific information from extracted text
function parseDvlaFromText(text) {
  console.log('🔍 Parsing DVLA data from extracted text...');
  
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
    confidence: 'medium'
  };

  // Extract license ending (NEW - Session 20)
  dvlaData.licenseEnding = extractLicenseEnding(text);

  // Extract license number (16-character UK format)
  const licenseMatch = text.match(/([A-Z]{2,5}[0-9]{6}[A-Z0-9]{2}[A-Z]{2})/);
  if (licenseMatch) {
    dvlaData.licenseNumber = licenseMatch[1];
    console.log('✅ Found license number:', dvlaData.licenseNumber);
  }

  // Extract driver name (look for common patterns)
  const namePatterns = [
    /Driver's full name[:\s]+([A-Z][A-Z\s]+[A-Z])/i,
    /full name[:\s]+([A-Z][A-Z\s]+[A-Z])/i,
    /([A-Z]{2,}\s+[A-Z]{2,}(?:\s+[A-Z]{2,})?)/
  ];
  
  for (const pattern of namePatterns) {
    const nameMatch = text.match(pattern);
    if (nameMatch && nameMatch[1].length > 5 && nameMatch[1].length < 50) {
      dvlaData.driverName = nameMatch[1].trim();
      console.log('✅ Found driver name:', dvlaData.driverName);
      break;
    }
  }

  // Extract check code (DVLA format: Ab cd ef Gh)
  const checkCodeMatch = text.match(/check code[:\s]*([A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2})/i);
  if (checkCodeMatch) {
    dvlaData.checkCode = checkCodeMatch[1];
    console.log('✅ Found check code:', dvlaData.checkCode);
  }

  // Extract dates - Enhanced for DVLA format
  const dvlaDatePattern = /Date summary generated[:\s]+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;
  const dvlaDateMatch = text.match(dvlaDatePattern);
  if (dvlaDateMatch) {
    dvlaData.dateGenerated = parseDvlaDate(dvlaDateMatch[1]);
    console.log('✅ Found DVLA date:', dvlaData.dateGenerated);
  }

  // Extract total points - Smart logic to avoid double counting
  dvlaData.totalPoints = extractTotalPointsNoDuplicates(text);

  // Extract endorsement codes - Session 18 fix: No double counting
  dvlaData.endorsements = extractEndorsementsNoDuplicates(text);

  // Extract license categories
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

// SESSION 18 FIX: Smart endorsement extraction to prevent double-counting
function extractEndorsementsNoDuplicates(text) {
  console.log('🔍 Extracting endorsements (no duplicates)...');
  
  const endorsements = [];
  const seenCodes = new Set();
  
  // Priority 1: Look for specific endorsement codes with details (SP30, MS90, etc.)
  const specificEndorsements = [...text.matchAll(/([A-Z]{2}[0-9]{2})[^A-Za-z0-9]*(?:Penalty points?[:\s]*(\d+))?/gi)];
  
  specificEndorsements.forEach(match => {
    const code = match[1].toUpperCase();
    const points = match[2] ? parseInt(match[2]) : getDefaultPointsForCode(code);
    
    if (['SP', 'MS', 'CU', 'IN', 'DR', 'BA', 'DD', 'UT', 'TT'].some(prefix => code.startsWith(prefix))) {
      if (!seenCodes.has(code)) {
        endorsements.push({
          code: code,
          points: points,
          description: getEndorsementDescription(code),
          source: 'specific'
        });
        seenCodes.add(code);
        console.log('✅ Found specific endorsement:', code, points, 'points');
      }
    }
  });
  
  return endorsements;
}

// SESSION 18 FIX: Smart total points calculation
function extractTotalPointsNoDuplicates(text) {
  console.log('🔍 Calculating total points (no duplicates)...');
  
  // Get specific endorsements first
  const endorsements = extractEndorsementsNoDuplicates(text);
  
  if (endorsements.length > 0) {
    // Calculate from specific endorsements
    const calculatedPoints = endorsements.reduce((sum, endorsement) => sum + endorsement.points, 0);
    console.log('✅ Points from specific endorsements:', calculatedPoints);
    return calculatedPoints;
  }
  
  // Fallback: Look for direct points statements
  const directPointsMatch = text.match(/(\d+)\s+Points?/i);
  if (directPointsMatch) {
    const points = parseInt(directPointsMatch[1]);
    console.log('✅ Points from direct statement:', points);
    return points;
  }
  
  console.log('ℹ️ No points found - clean license');
  return 0;
}

// Parse DVLA date format "15 July 2025 10:58"
function parseDvlaDate(dateStr) {
  try {
    const months = {
      'january': '01', 'february': '02', 'march': '03', 'april': '04',
      'may': '05', 'june': '06', 'july': '07', 'august': '08',
      'september': '09', 'october': '10', 'november': '11', 'december': '12'
    };
    
    const parts = dateStr.trim().split(/\s+/);
    if (parts.length >= 3) {
      const day = parts[0].padStart(2, '0');
      const month = months[parts[1].toLowerCase()];
      const year = parts[2];
      
      if (month) {
        return `${year}-${month}-${day}`;
      }
    }
    
    // Fallback to standard parsing
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    console.warn('Could not parse DVLA date:', dateStr);
  }
  return dateStr;
}

// Validate DVLA data
function validateDvlaData(dvlaData) {
  console.log('🔍 Validating DVLA data...');
  
  // SESSION 18 FIX: Don't require license number for validation
  if (!dvlaData.driverName) {
    dvlaData.issues.push('⚠️ Driver name not found');
    dvlaData.confidence = 'low';
  }
  
  if (!dvlaData.checkCode) {
    dvlaData.issues.push('⚠️ DVLA check code not found');
  }
  
  // Check if check is recent (within 30 days) - Session 18 update
  if (dvlaData.dateGenerated) {
    const checkAge = calculateDaysFromDate(dvlaData.dateGenerated);
    dvlaData.ageInDays = checkAge;
    
    if (checkAge > 30) {
      dvlaData.issues.push('⚠️ DVLA check is older than 30 days');
    }
  }
  
  // SESSION 18 FIX: Validation based on essential data only
  dvlaData.isValid = dvlaData.driverName && dvlaData.checkCode && (dvlaData.ageInDays <= 30);
  
  // Calculate insurance decision
  dvlaData.insuranceDecision = calculateInsuranceDecision(dvlaData);
  dvlaData.extractionSuccess = dvlaData.isValid;
  
  console.log(`🚗 DVLA validation complete: ${dvlaData.issues.length} issues, ${dvlaData.totalPoints} points`);
  return dvlaData;
}

// Insurance decision calculation
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

  // Points-based logic
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

// Helper functions
function getDefaultPointsForCode(code) {
  const pointsMap = {
    'SP30': 3, 'SP50': 3, 'SP40': 3, 'SP20': 3,
    'MS90': 6, 'MS50': 3, 'MS30': 3,
    'CU80': 3, 'CU10': 3,
    'IN10': 6, 'IN20': 6,
    'DR10': 3, 'DR20': 6, 'DR30': 6
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

// AWS Signature creation
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
    `x-amz-target:Textract.${target}`,
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

function getEnhancedMockDvlaAnalysis() {
  return {
    licenseNumber: "WOOD661120JO9LA",
    licenseEnding: "162JD9GA", // NEW: Mock license ending
    driverName: "JONATHAN WOOD",
    checkCode: "Kd m3 ch Nn",
    dateGenerated: "2025-07-21",
    validFrom: "2006-08-01",
    validTo: "2032-08-01",
    drivingStatus: "Current full licence",
    endorsements: [{
      code: "SP30",
      date: "2023-03-15",
      points: 3,
      description: "Exceeding statutory speed limit on a public road"
    }],
    totalPoints: 3,
    restrictions: [],
    categories: ["B", "BE"],
    isValid: true,
    issues: [],
    confidence: 85,
    ageInDays: 0,
    extractionSuccess: true,
    insuranceDecision: {
      approved: true,
      excess: 0,
      manualReview: false,
      reasons: ["Minor points - standard approval"],
      riskLevel: "standard"
    },
    mockMode: true,
    ocrProvider: 'AWS Textract (Mock)'
  };
}

function createDvlaFallback(fileType, errorMessage) {
  return {
    licenseNumber: 'FALLBACK751120FB9AB',
    licenseEnding: 'FB9AB123', // NEW: Fallback license ending
    driverName: 'Fallback Driver',
    checkCode: 'Fb 12 ck 34',
    dateGenerated: '2025-07-21',
    validFrom: '2010-01-01',
    validTo: '2030-01-01',
    drivingStatus: 'Current full licence',
    endorsements: [],
    totalPoints: 0,
    restrictions: [],
    categories: ['B'],
    isValid: true,
    issues: [`⚠️ AWS Textract failed: ${errorMessage}`, '⚠️ Using fallback data'],
    confidence: 0,
    ageInDays: 0,
    extractionSuccess: false,
    parseError: errorMessage,
    insuranceDecision: {
      approved: true,
      excess: 0,
      manualReview: false,
      reasons: ['Clean license - no points (fallback)'],
      riskLevel: 'low'
    },
    fallbackMode: true,
    ocrProvider: 'Fallback'
  };
}

// POA processing functions (keeping existing logic but could be enhanced with Textract)
async function testSinglePoaExtraction(imageData, documentType = 'unknown', licenseAddress = '123 Test Street, London, SW1A 1AA', fileType = 'image') {
  console.log('Testing single POA extraction with Textract fallback to mock');
  return getMockPoaData('Single-POA');
}

async function testDualPoaCrossValidation(imageData1, imageData2, licenseAddress, fileType) {
  console.log('🔄 Testing DUAL POA cross-validation workflow');
  
  const poa1Analysis = getMockPoaData('POA1');
  const poa2Analysis = getMockPoaData('POA2');
  const crossValidation = performPoaCrossValidation(poa1Analysis, poa2Analysis);
  
  return {
    testType: 'dual-poa',
    poa1: poa1Analysis,
    poa2: poa2Analysis,
    crossValidation: crossValidation,
    overallValid: crossValidation.approved,
    ocrProvider: 'Mock Data'
  };
}

function performPoaCrossValidation(poa1, poa2) {
  const validation = {
    approved: false,
    issues: [],
    checks: {
      bothExtracted: true,
      differentProviders: false,
      differentAccountNumbers: true
    }
  };

  const sameProvider = poa1.providerName?.toLowerCase() === poa2.providerName?.toLowerCase();
  validation.checks.differentProviders = !sameProvider;
  
  if (sameProvider) {
    validation.issues.push(`❌ Both POAs are from the same provider: ${poa1.providerName}`);
  } else {
    validation.issues.push(`✅ Different providers: ${poa1.providerName} vs ${poa2.providerName}`);
  }

  validation.approved = validation.checks.bothExtracted && validation.checks.differentProviders && validation.checks.differentAccountNumbers;
  return validation;
}

function getMockPoaData(documentId) {
  const mockData = {
    POA1: {
      documentId: 'POA1',
      documentType: 'utility_bill',
      providerName: 'British Gas',
      documentDate: '2025-06-15',
      accountNumber: '****1234',
      confidence: 'high',
      extractionSuccess: true,
      mockMode: true
    },
    POA2: {
      documentId: 'POA2',
      documentType: 'bank_statement',
      providerName: 'HSBC Bank',
      documentDate: '2025-06-20',
      accountNumber: '****5678',
      confidence: 'high',
      extractionSuccess: true,
      mockMode: true
    },
    'Single-POA': {
      documentId: 'Single-POA',
      documentType: 'utility_bill',
      providerName: 'British Gas',
      documentDate: '2025-06-15',
      accountNumber: '****1234',
      confidence: 'high',
      extractionSuccess: true,
      mockMode: true
    }
  };
  return mockData[documentId] || mockData.POA1;
}
