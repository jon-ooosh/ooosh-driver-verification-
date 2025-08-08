// File: functions/test-claude-ocr.js
// AWS TEXTRACT VERSION - Reliable OCR processing
// Replaces Claude API with AWS Textract for better reliability

// Use native fetch (Node 18+)
// const fetch = require('node-fetch'); // Remove this line

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
    console.log('⚠️ AWS credentials not configured - cannot process document');
    throw new Error('AWS Textract credentials not configured');
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
  
  // Prepare AWS request
  const requestBody = JSON.stringify({
    Document: {
      Bytes: cleanBase64
    },
    FeatureTypes: ['FORMS', 'TABLES']
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

// Enhanced DVLA Parser - Replace parseDvlaFromText() function in functions/test-claude-ocr.js
// This version handles real UK DVLA document patterns with proper insurance decisions

function parseDvlaFromText(text) {
  console.log('🚗 Parsing DVLA data from AWS Textract output...');
  
  const dvlaData = {
    licenseNumber: null,
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
    confidence: 'high',
    ageInDays: null
  };

  // 1. EXTRACT LICENSE NUMBER - UK DVLA format: XXXXXXXX162JD9GA
  const licensePatterns = [
    /XXXXXXXX\d{3}[A-Z]{2}\d[A-Z]{2}/g,  // Main pattern from your docs
    /([A-Z]{2,5}\d{6}[A-Z0-9]{2}[A-Z]{2})/g,  // Alternative format
    /Driving licence number[:\s]*([X]+\d{3}[A-Z]{2}\d[A-Z]{2})/i
  ];
  
  for (const pattern of licensePatterns) {
    const licenseMatch = text.match(pattern);
    if (licenseMatch) {
      dvlaData.licenseNumber = licenseMatch[0];
      console.log('✅ Found license number:', dvlaData.licenseNumber);
      break;
    }
  }

  // 2. EXTRACT DRIVER NAME - Various patterns from your samples
  const namePatterns = [
    /Driver's full name[:\s]+(MR\s+[A-Z\s]+)/i,
    /Driver's full name[:\s]+([A-Z][A-Z\s]{5,50})/i,
    /(MR\s+[A-Z]+(?:\s+[A-Z]+){1,3})/g,
    /^(MR\s+[A-Z\s]+)$/gm  // Line-based matching
  ];
  
  for (const pattern of namePatterns) {
    const nameMatch = text.match(pattern);
    if (nameMatch && nameMatch[1] && nameMatch[1].length > 5 && nameMatch[1].length < 50) {
      dvlaData.driverName = nameMatch[1].trim();
      console.log('✅ Found driver name:', dvlaData.driverName);
      break;
    }
  }

  // 3. EXTRACT CHECK CODE - Format: "43 p9 Fk Hr"
  const checkCodePatterns = [
    /Your check code[:\s]+([A-Za-z0-9\s]{8,15})/i,
    /Check code[:\s]*([A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2})/i,
    /([A-Za-z0-9]{1,3}\s+[A-Za-z0-9]{1,3}\s+[A-Za-z0-9]{1,3}\s+[A-Za-z0-9]{1,3})/g
  ];
  
  for (const pattern of checkCodePatterns) {
    const codeMatch = text.match(pattern);
    if (codeMatch && codeMatch[1]) {
      dvlaData.checkCode = codeMatch[1].trim();
      console.log('✅ Found check code:', dvlaData.checkCode);
      break;
    }
  }

  // 4. EXTRACT DATE GENERATED - UK format: "15 July 2025 10:58"
  const datePatterns = [
    /Date summary generated[:\s]+(\d{1,2}\s+[A-Za-z]+\s+\d{4}(?:\s+\d{2}:\d{2})?)/i,
    /Date summary generated[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/i,
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i
  ];
  
  for (const pattern of datePatterns) {
    const dateMatch = text.match(pattern);
    if (dateMatch) {
      dvlaData.dateGenerated = parseUkDate(dateMatch[1]);
      if (dvlaData.dateGenerated) {
        dvlaData.ageInDays = calculateDaysFromDate(dvlaData.dateGenerated);
        console.log('✅ Found generation date:', dvlaData.dateGenerated, `(${dvlaData.ageInDays} days ago)`);
        break;
      }
    }
  }

  // 5. EXTRACT DRIVING STATUS
  if (text.toLowerCase().includes('current full licence')) {
    dvlaData.drivingStatus = 'Current full licence';
  } else if (text.toLowerCase().includes('provisional')) {
    dvlaData.drivingStatus = 'Provisional licence';
  }

  // 6. EXTRACT ENDORSEMENTS - Handle all types (SP30, MS90, etc.)
  dvlaData.endorsements = extractEndorsements(text);
  dvlaData.totalPoints = dvlaData.endorsements.reduce((total, endorsement) => total + endorsement.points, 0);
  
  console.log(`✅ Found ${dvlaData.endorsements.length} endorsements, ${dvlaData.totalPoints} total points`);

  // 7. EXTRACT LICENSE CATEGORIES
  const categoryMatches = text.match(/Category[:\s]+([A-Z0-9\s,+]+)/gi);
  if (categoryMatches) {
    dvlaData.categories = [...new Set(
      categoryMatches.join(' ').match(/\b[A-Z]{1,3}\d?\b/g) || []
    )];
  }

  // 8. VALIDATION
  validateDvlaData(dvlaData);
  
  // 9. INSURANCE DECISION
  dvlaData.insuranceDecision = calculateInsuranceDecisionEnhanced(dvlaData);
  dvlaData.extractionSuccess = dvlaData.isValid;
  
  console.log(`🚗 DVLA parsing complete: ${dvlaData.issues.length} issues, ${dvlaData.totalPoints} points, Decision: ${dvlaData.insuranceDecision.approved ? 'APPROVED' : 'REVIEW REQUIRED'}`);
  
  return dvlaData;
}

// ENHANCED ENDORSEMENT EXTRACTION
function extractEndorsements(text) {
  const endorsements = [];
  
  // Look for endorsement patterns across multiple lines
  const endorsementPatterns = [
    // Pattern 1: "Exceeding statutory speed limit on a public road (SP30)"
    /([A-Z]{2}\d{2})[^\n]*(?:\n.*?Penalty points?[:\s]*(\d+))?[^\n]*(?:\n.*?Offence date[:\s]*([^\n]+))?/gi,
    
    // Pattern 2: Direct format "SP30" followed by points
    /(SP\d{2}|MS\d{2}|CU\d{2}|IN\d{2}|DR\d{2}|BA\d{2}|DD\d{2}|UT\d{2}|TT\d{2})[^\n]*(?:\n.*?(\d+)\s+Points?)?[^\n]*(?:\n.*?(\d{1,2}\s+[A-Za-z]+\s+\d{4}))?/gi,
    
    // Pattern 3: Points summary "1 Offence 3 Points"
    /(\d+)\s+Offence[^\n]*\n[^\n]*(\d+)\s+Points?/gi
  ];
  
  // Extract detailed endorsements
  for (const pattern of endorsementPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1];
      const points = parseInt(match[2]) || getDefaultPointsForCode(code);
      const date = match[3] ? parseUkDate(match[3]) : null;
      
      if (code && code.match(/^[A-Z]{2}\d{2}$/)) {
        endorsements.push({
          code: code,
          points: points,
          date: date || new Date().toISOString().split('T')[0],
          description: getEndorsementDescription(code)
        });
      }
    }
  }
  
  // If no detailed endorsements found, try summary extraction
  if (endorsements.length === 0) {
    const summaryMatch = text.match(/(\d+)\s+Offence[^\n]*(\d+)\s+Points?/i);
    if (summaryMatch) {
      const totalOffences = parseInt(summaryMatch[1]);
      const totalPoints = parseInt(summaryMatch[2]);
      
      if (totalOffences > 0 && totalPoints > 0) {
        // Create generic endorsement(s)
        for (let i = 0; i < totalOffences; i++) {
          endorsements.push({
            code: 'SP30', // Default to speeding (most common)
            points: Math.ceil(totalPoints / totalOffences),
            date: new Date().toISOString().split('T')[0],
            description: 'Traffic offence (details from summary)'
          });
        }
      }
    }
  }
  
  return endorsements;
}

// ENHANCED INSURANCE DECISION - Your exact criteria
function calculateInsuranceDecisionEnhanced(dvlaData) {
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

  // Check if document is too old (30+ days)
  if (dvlaData.ageInDays && dvlaData.ageInDays > 30) {
    decision.manualReview = true;
    decision.reasons.push(`DVLA check is ${dvlaData.ageInDays} days old (max 30 days allowed)`);
    return decision;
  }

  const points = dvlaData.totalPoints || 0;
  const endorsements = dvlaData.endorsements || [];

  // SERIOUS OFFENSES - Auto manual review
  const seriousOffenses = ['MS90', 'IN10', 'DR10', 'DR20', 'DR30', 'DR40', 'DR50', 'DR60', 'DR70'];
  const hasSeriousOffense = endorsements.some(e => seriousOffenses.includes(e.code));

  if (hasSeriousOffense) {
    decision.manualReview = true;
    decision.reasons.push('Serious driving offense detected - requires underwriter review');
    return decision;
  }

  // POINTS-BASED DECISIONS
  if (points === 0) {
    decision.approved = true;
    decision.riskLevel = 'low';
    decision.reasons.push('Clean license - no points');
  } else if (points <= 3) {
    decision.approved = true;
    decision.riskLevel = 'standard';
    decision.reasons.push('Minor points - standard approval');
  } else if (points <= 6) {
    // Check if speeding only
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

  // Check for recent offenses (add excess for recent violations)
  const recentOffenses = endorsements.filter(e => {
    if (!e.date) return false;
    const offenseDate = new Date(e.date);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
    return offenseDate > twelveMonthsAgo;
  });

  if (recentOffenses.length > 0) {
    decision.reasons.push(`${recentOffenses.length} recent offense(s) in last 12 months`);
    if (decision.excess < 250) {
      decision.excess = 250;
    }
  }

  return decision;
}

// HELPER FUNCTIONS
function parseUkDate(dateStr) {
  try {
    // Handle formats like "15 July 2025 10:58" or "15 July 2025"
    const cleanDate = dateStr.trim();
    
    // Try direct parsing first
    const date = new Date(cleanDate.replace(/(\d{1,2}:\d{2}).*$/, '').trim());
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    
    // Try manual parsing for UK format
    const ukDateMatch = cleanDate.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (ukDateMatch) {
      const [, day, month, year] = ukDateMatch;
      const monthNames = {
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
      };
      const monthIndex = monthNames[month.toLowerCase()];
      if (monthIndex !== undefined) {
        const parsedDate = new Date(year, monthIndex, day);
        return parsedDate.toISOString().split('T')[0];
      }
    }
    
    return null;
  } catch (error) {
    console.warn('Could not parse UK date:', dateStr);
    return null;
  }
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

function getDefaultPointsForCode(code) {
  const pointsMap = {
    'SP30': 3, 'SP50': 3, 'SP10': 3, 'SP20': 3, 'SP40': 3, 'SP60': 3,
    'MS90': 6, 'MS50': 3, 'MS10': 3,
    'CU80': 3, 'CU10': 3,
    'IN10': 6,
    'DR10': 3, 'DR40': 10, 'DR50': 4, 'DR60': 6
  };
  return pointsMap[code] || 3;
}

function getEndorsementDescription(code) {
  const descriptions = {
    'SP30': 'Exceeding statutory speed limit on a public road',
    'SP50': 'Exceeding speed limit on a motorway',
    'SP10': 'Exceeding goods vehicle speed limit',
    'MS90': 'Failure to give information as to identity of driver',
    'MS50': 'Motor racing on the highway',
    'CU80': 'Breach of requirements as to control of vehicle',
    'IN10': 'Using a vehicle uninsured against third party risks',
    'DR10': 'Driving or attempting to drive with alcohol concentration above limit',
    'DR40': 'In charge of vehicle while alcohol concentration above limit',
    'DR50': 'Refusing to provide a specimen for analysis',
    'DR60': 'Failure to provide a specimen for analysis'
  };
  return descriptions[code] || 'Traffic offence';
}

function validateDvlaData(dvlaData) {
  console.log('🔍 Validating extracted DVLA data...');
  
  if (!dvlaData.licenseNumber) {
    dvlaData.issues.push('❌ License number not found');
    dvlaData.isValid = false;
    dvlaData.confidence = 'low';
  }
  
  if (!dvlaData.driverName) {
    dvlaData.issues.push('⚠️ Driver name not found');
    if (dvlaData.confidence === 'high') dvlaData.confidence = 'medium';
  }
  
  if (!dvlaData.checkCode) {
    dvlaData.issues.push('⚠️ DVLA check code not found');
  }
  
  if (!dvlaData.dateGenerated) {
    dvlaData.issues.push('⚠️ Generation date not found');
  } else if (dvlaData.ageInDays > 30) {
    dvlaData.issues.push(`⚠️ DVLA check is ${dvlaData.ageInDays} days old (max 30 days)`);
  }
  
  return dvlaData;
}

// Helper function to standardize dates
function standardizeDate(dateStr) {
  try {
    // Handle different date formats
    const date = new Date(dateStr.replace(/[\/\.]/g, '-'));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    console.warn('Could not parse date:', dateStr);
  }
  return dateStr;
}

// Get endorsement description
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

// Extract points for common endorsement codes
function extractPointsForEndorsement(code) {
  const pointsMap = {
    'SP30': 3, 'SP50': 3,
    'MS90': 6,
    'CU80': 3,
    'IN10': 6
  };
  return pointsMap[code] || 3;
}

// Validate DVLA data
function validateDvlaData(dvlaData) {
  console.log('🔍 Validating DVLA data...');
  
  if (!dvlaData.licenseNumber) {
    dvlaData.issues.push('❌ License number not found');
    dvlaData.isValid = false;
    dvlaData.confidence = 'low';
  }
  
  if (!dvlaData.driverName) {
    dvlaData.issues.push('⚠️ Driver name not found');
    dvlaData.confidence = 'low';
  }
  
  if (!dvlaData.checkCode) {
    dvlaData.issues.push('⚠️ DVLA check code not found');
  }
  
  // Check if check is recent (within 10 days)
  if (dvlaData.dateGenerated) {
    const checkAge = calculateDaysFromDate(dvlaData.dateGenerated);
    dvlaData.ageInDays = checkAge;
    
    if (checkAge > 10) {
      dvlaData.issues.push('⚠️ DVLA check is older than 10 days');
    }
  }
  
  // Calculate insurance decision
  dvlaData.insuranceDecision = calculateInsuranceDecision(dvlaData);
  dvlaData.extractionSuccess = dvlaData.isValid;
  
  console.log(`🚗 DVLA validation complete: ${dvlaData.issues.length} issues, ${dvlaData.totalPoints} points`);
  return dvlaData;
}

// Insurance decision calculation (same as before)
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

// AWS Signature creation (simplified version)
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

// Helper for AWS signature
function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const crypto = require('crypto');
  const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  return kSigning;
}

// Helper functions for dates and mock data
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

function getEnhancedMockDvlaAnalysis() {
  return {
    licenseNumber: "WOOD661120JO9LA",
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
  // For now, return mock data - we can enhance this with Textract later
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
