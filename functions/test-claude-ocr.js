// File: functions/test-claude-ocr.js
// COMPLETE VERSION - Enhanced DVLA Parser with License Ending Fix
// Session 19: Debugging license ending extraction + database improvements

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('AWS Textract OCR Test function called - Session 19 Enhanced');
  
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

// ENHANCED: DVLA processing with FIXED license ending extraction
async function testDvlaExtractionWithTextract(imageData, fileType = 'image') {
  console.log('🚗 Testing DVLA OCR with AWS Textract - Session 19 Enhanced');
  
  if (!process.env.OOOSH_AWS_ACCESS_KEY_ID || !process.env.OOOSH_AWS_SECRET_ACCESS_KEY) {
    console.log('⚠️ AWS credentials not configured - using enhanced fallback');
    return getEnhancedMockDvlaAnalysis();
  }

  try {
    console.log('📞 Calling AWS Textract for DVLA analysis...');
    
    // Call AWS Textract
    const textractResult = await callAwsTextract(imageData, fileType);
    
    // ENHANCED: Parse DVLA-specific data with license ending extraction
    const dvlaData = parseDvlaFromTextEnhanced(textractResult.extractedText);
    
    // Validate and enhance the data
    const validatedData = validateDvlaDataEnhanced(dvlaData);
    
    console.log('✅ AWS Textract DVLA analysis successful');
    return validatedData;

  } catch (error) {
    console.log('❌ AWS Textract failed:', error.message);
    
    // Return the error directly instead of fallback
    return {
      licenseNumber: null,
      licenseEnding: null,
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
      isValid: false,
      issues: [`❌ Processing failed: ${error.message}`],
      confidence: 0,
      ageInDays: 0,
      extractionSuccess: false,
      parseError: error.message,
      insuranceDecision: {
        approved: false,
        excess: 0,
        manualReview: true,
        reasons: ['Document processing failed'],
        riskLevel: 'unknown'
      },
      extractionDetails: {
        licensePatterns: [],
        endorsementSources: [],
        dateFormats: [],
        debugInfo: { error: error.message, stack: error.stack }
      },
      errorMode: true,
      ocrProvider: 'AWS Textract (Failed)'
    };
  }
}

// ENHANCED: Parse DVLA data with FIXED license ending extraction
function parseDvlaFromTextEnhanced(text) {
  console.log('🔍 Enhanced DVLA parsing with license ending extraction...');
  
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
    confidence: 'high',
    
    // Processing metadata
    extractionDetails: {
      licensePatterns: [],
      endorsementSources: [],
      dateFormats: [],
      debugInfo: {}
    }
  };

  // ENHANCED: Multiple license number patterns with detailed logging
  console.log('🔍 Searching for license patterns...');
  
  const licensePatterns = [
    // Full UK license format: WOOD661120JO9LA
    /([A-Z]{2,5}[0-9]{6}[A-Z0-9]{2}[A-Z]{2})/g,
    // Partial format: XXXXXXXX162JD9GA (common in DVLA summaries)
    /(XXXXXXXX[A-Z0-9]{2}[A-Z]{2})/g,
    // Mixed partial: WOOD****20JO9LA
    /([A-Z]{2,5}[\*X]{1,6}[0-9]{2}[A-Z0-9]{2}[A-Z]{2})/g
  ];

  licensePatterns.forEach((pattern, index) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const found = match[1];
      dvlaData.extractionDetails.licensePatterns.push({
        pattern: index,
        found: found,
        position: match.index
      });
      console.log(`📝 License pattern ${index}: "${found}" at position ${match.index}`);
    });
  });

  // FIXED: License ending extraction with multiple fallback patterns
  console.log('🎯 Extracting license ending for anti-fraud validation...');
  
  // Pattern 1: Full license number (ideal)
  const fullLicenseMatch = text.match(/([A-Z]{2,5}[0-9]{6}[A-Z0-9]{2}[A-Z]{2})/);
  if (fullLicenseMatch) {
    dvlaData.licenseNumber = fullLicenseMatch[1];
    dvlaData.licenseEnding = fullLicenseMatch[1].slice(-8); // Last 8 characters
    console.log('✅ Full license found:', dvlaData.licenseNumber);
    console.log('✅ License ending extracted:', dvlaData.licenseEnding);
  }

  // Pattern 2: Partial format XXXXXXXX162JD9GA (backup method)
  if (!dvlaData.licenseEnding) {
    const partialMatches = [...text.matchAll(/(XXXXXXXX[A-Z0-9]{2}[A-Z]{2})/g)];
    if (partialMatches.length > 0) {
      const partialLicense = partialMatches[0][1];
      dvlaData.licenseEnding = partialLicense.replace('XXXXXXXX', ''); // Remove XXXXXXXX prefix
      console.log('✅ Partial license found:', partialLicense);
      console.log('✅ License ending from partial:', dvlaData.licenseEnding);
      dvlaData.extractionDetails.debugInfo.partialLicenseUsed = true;
    }
  }

  // Pattern 3: License ending in document text (fallback)
  if (!dvlaData.licenseEnding) {
    // Look for patterns like "ending 162JD9GA" or "last digits 162JD9GA"
    const endingPatterns = [
      /ending\s+([A-Z0-9]{4,8})/i,
      /last\s+digits?\s+([A-Z0-9]{4,8})/i,
      /licence\s+number\s+[^\s]*([A-Z0-9]{4,8})/i
    ];
    
    for (const pattern of endingPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        dvlaData.licenseEnding = match[1];
        console.log('✅ License ending from text pattern:', dvlaData.licenseEnding);
        dvlaData.extractionDetails.debugInfo.endingPatternUsed = true;
        break;
      }
    }
  }

  // Safety check: Ensure licenseEnding is string or null, not undefined
  if (!dvlaData.licenseEnding) {
    dvlaData.licenseEnding = null;
    console.log('⚠️ No license ending found');
  }

  // Log final license extraction results
  dvlaData.extractionDetails.debugInfo.finalLicenseNumber = dvlaData.licenseNumber;
  dvlaData.extractionDetails.debugInfo.finalLicenseEnding = dvlaData.licenseEnding;

  // Extract driver name with enhanced patterns
  console.log('👤 Extracting driver name...');
  const namePatterns = [
    /Name[:\s]+([A-Z][A-Z\s]+[A-Z])/,
    /([A-Z]{2,}\s+[A-Z]{2,}(?:\s+[A-Z]{2,})?)/,
    /Driver[:\s]+([A-Z][A-Z\s]+)/i
  ];
  
  for (const pattern of namePatterns) {
    const nameMatch = text.match(pattern);
    if (nameMatch && nameMatch[1] && nameMatch[1].length > 5 && nameMatch[1].length < 50) {
      dvlaData.driverName = nameMatch[1].trim();
      console.log('✅ Found driver name:', dvlaData.driverName);
      break;
    }
  }

  // Extract check code (DVLA format: Ab cd ef Gh)
  console.log('🔑 Extracting DVLA check code...');
  const checkCodeMatch = text.match(/([A-Za-z]{1,2}\s+[A-Za-z0-9]{1,2}\s+[A-Za-z0-9]{1,2}\s+[A-Za-z0-9]{1,2})/);
  if (checkCodeMatch) {
    dvlaData.checkCode = checkCodeMatch[1];
    console.log('✅ Found check code:', dvlaData.checkCode);
  }

  // ENHANCED: Date extraction with UK-specific patterns
  console.log('📅 Extracting dates...');
  const datePatterns = [
    // UK long format: "Date summary generated 15 July 2025 10:58"
    /Date\s+summary\s+generated\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
    // Standard formats
    /(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/g,
    /(\d{4}[\/\-\.]\d{2}[\/\-\.]\d{2})/g,
    // UK date format: 15 July 2025
    /(\d{1,2}\s+[A-Za-z]+\s+\d{4})/g
  ];
  
  datePatterns.forEach((pattern, index) => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const dateStr = match[1];
      const standardized = standardizeDate(dateStr);
      dvlaData.extractionDetails.dateFormats.push({
        pattern: index,
        original: dateStr,
        standardized: standardized
      });
    });
  });

  // Set the most recent/relevant date as generation date
  if (dvlaData.extractionDetails.dateFormats.length > 0) {
    // Prefer the first date found (usually the generation date)
    dvlaData.dateGenerated = dvlaData.extractionDetails.dateFormats[0].standardized;
  }

  // FIXED: Smart endorsement extraction (no double counting)
  console.log('⚖️ Extracting endorsements with smart deduplication...');
  dvlaData.endorsements = extractEndorsementsNoDuplicates(text);
  dvlaData.totalPoints = dvlaData.endorsements.reduce((sum, e) => sum + (e.points || 0), 0);

  // Extract license categories
  const categoryMatch = text.match(/categories?[:\s]*([A-Z0-9\s,+]+)/i);
  if (categoryMatch) {
    dvlaData.categories = categoryMatch[1].split(/[,\s+]/).filter(c => c.length > 0);
  }

  // Check for driving status
  if (text.toLowerCase().includes('current') && text.toLowerCase().includes('licence')) {
    dvlaData.drivingStatus = 'Current full licence';
  }

  console.log('📋 DVLA parsing complete:', {
    name: dvlaData.driverName,
    licenseEnding: dvlaData.licenseEnding,
    points: dvlaData.totalPoints,
    endorsements: dvlaData.endorsements.length
  });

  return dvlaData;
}

// NEW: Smart endorsement extraction with deduplication
function extractEndorsementsNoDuplicates(text) {
  console.log('🔍 Smart endorsement extraction starting...');
  
  const endorsements = [];
  const seenCodes = new Set();
  
  // Priority 1: Specific endorsement codes with details (SP30, MS90, etc.)
  const specificPatterns = [
    // Pattern: "SP30 Penalty points: 3"
    /([A-Z]{2}[0-9]{2})\s+[^0-9]*?(\d+)\s*points?/gi,
    // Pattern: "SP30 Exceeding speed limit 3 points"
    /([A-Z]{2}[0-9]{2})[^0-9]*?(\d+)\s*points?/gi,
    // Pattern: Just the code "SP30" (we'll assign default points)
    /\b([A-Z]{2}[0-9]{2})\b/gi
  ];

  specificPatterns.forEach((pattern, patternIndex) => {
    console.log(`🔍 Checking pattern ${patternIndex + 1}...`);
    const matches = [...text.matchAll(pattern)];
    
    matches.forEach(match => {
      const code = match[1];
      const points = match[2] ? parseInt(match[2]) : getDefaultPointsForCode(code);
      
      console.log(`📝 Found endorsement: ${code} (${points} points)`);
      
      // Only add if we haven't seen this code before
      if (!seenCodes.has(code) && isValidEndorsementCode(code)) {
        seenCodes.add(code);
        endorsements.push({
          code: code,
          date: new Date().toISOString().split('T')[0], // Default to today
          points: points,
          description: getEndorsementDescription(code),
          source: `pattern_${patternIndex + 1}`
        });
        console.log(`✅ Added endorsement: ${code}`);
      } else {
        console.log(`⚠️ Skipped duplicate/invalid: ${code}`);
      }
    });
  });

  // Priority 2: Summary patterns (only if no specific codes found)
  if (endorsements.length === 0) {
    console.log('📊 No specific codes found, checking summary patterns...');
    
    const summaryPatterns = [
      // "1 Offence 3 Points"
      /(\d+)\s+offences?\s+(\d+)\s+points?/gi,
      // "3 penalty points"
      /(\d+)\s+penalty\s+points?/gi
    ];

    summaryPatterns.forEach((pattern, patternIndex) => {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        const points = parseInt(match[2] || match[1]);
        if (points > 0) {
          endorsements.push({
            code: `XX${points.toString().padStart(2, '0')}`, // Generic code
            date: new Date().toISOString().split('T')[0],
            points: points,
            description: `Traffic offence (${points} points)`,
            source: `summary_${patternIndex + 1}`
          });
          console.log(`✅ Added summary endorsement: ${points} points`);
        }
      });
    });
  }

  console.log(`📋 Final endorsements: ${endorsements.length} found, ${seenCodes.size} unique codes`);
  return endorsements;
}

// Helper: Check if endorsement code is valid
function isValidEndorsementCode(code) {
  const validPrefixes = ['SP', 'MS', 'CU', 'IN', 'DR', 'BA', 'DD', 'UT', 'TT', 'CD', 'LC'];
  return validPrefixes.some(prefix => code.startsWith(prefix));
}

// Helper: Get default points for common codes
function getDefaultPointsForCode(code) {
  const pointsMap = {
    'SP30': 3, 'SP50': 3, 'SP10': 3, 'SP20': 3, 'SP40': 3,
    'MS90': 6, 'MS50': 3,
    'CU80': 3, 'CU10': 3,
    'IN10': 6, 'IN20': 6,
    'DR10': 3, 'DR20': 3, 'DR30': 3
  };
  return pointsMap[code] || 3; // Default to 3 points
}

// ENHANCED: Validation with license ending verification
function validateDvlaDataEnhanced(dvlaData) {
  console.log('🔍 Enhanced DVLA validation with license ending check...');
  
  // Check core required fields
  const hasDriverName = dvlaData.driverName && dvlaData.driverName.length > 2;
  const hasCheckCode = dvlaData.checkCode && dvlaData.checkCode.length > 5;
  const hasValidDate = dvlaData.dateGenerated && calculateDaysFromDate(dvlaData.dateGenerated) <= 30;
  
  // License ending is helpful but not mandatory for approval
  const hasLicenseEnding = dvlaData.licenseEnding && dvlaData.licenseEnding.length >= 4;
  
  // FIXED: Don't require license number for approval (DVLA often shows partial)
  dvlaData.isValid = hasDriverName && hasCheckCode && hasValidDate;
  
  // Clear previous issues
  dvlaData.issues = [];
  
  if (!hasDriverName) {
    dvlaData.issues.push('❌ Driver name not found');
    dvlaData.confidence = 'low';
  }
  
  if (!hasCheckCode) {
    dvlaData.issues.push('❌ DVLA check code not found');
    dvlaData.confidence = 'low';
  }
  
  if (!hasValidDate) {
    dvlaData.issues.push('⚠️ DVLA check date missing or older than 30 days');
  }
  
  // License ending warnings (not blockers)
  if (!hasLicenseEnding) {
    dvlaData.issues.push('⚠️ License ending not extracted (anti-fraud check limited)');
  } else {
    dvlaData.issues.push(`✅ License ending: ${dvlaData.licenseEnding} (anti-fraud ready)`);
  }
  
  // Check document age
  if (dvlaData.dateGenerated) {
    const checkAge = calculateDaysFromDate(dvlaData.dateGenerated);
    dvlaData.ageInDays = checkAge;
    
    if (checkAge > 30) {
      dvlaData.issues.push('⚠️ DVLA check is older than 30 days');
      dvlaData.isValid = false;
    } else {
      dvlaData.issues.push(`✅ DVLA check is ${checkAge} days old (fresh)`);
    }
  }
  
  // Calculate insurance decision
  dvlaData.insuranceDecision = calculateInsuranceDecision(dvlaData);
  dvlaData.extractionSuccess = dvlaData.isValid;
  
  console.log(`🚗 Enhanced validation complete:`, {
    valid: dvlaData.isValid,
    issues: dvlaData.issues.length,
    licenseEnding: dvlaData.licenseEnding,
    points: dvlaData.totalPoints
  });
  
  return dvlaData;
}

// (Rest of the functions remain the same - AWS signature, insurance calculation, etc.)

// AWS Textract call function (unchanged)
async function callAwsTextract(imageData, fileType) {
  console.log('📞 Calling AWS Textract API...');
  
  const region = process.env.OOOSH_AWS_REGION || 'eu-west-2';
  const endpoint = `https://textract.${region}.amazonaws.com/`;
  
  // Validate image size (AWS limit is 10MB)
  const imageSizeBytes = (imageData.length * 3) / 4;
  console.log(`📏 Image size: ${Math.round(imageSizeBytes / 1024)}KB`);
  
  if (imageSizeBytes > 10000000) {
    throw new Error('Image too large for AWS Textract (max 10MB)');
  }
  
  // Clean base64
  const cleanBase64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
  
  // Use DetectDocumentText for better PDF compatibility
  const requestBody = JSON.stringify({
    Document: { Bytes: cleanBase64 }
  });
  
  // Create AWS signature
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

// Insurance decision calculation (Session 18 logic)
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

  // Points-based decision logic (Session 18 validated)
  if (points === 0) {
    decision.approved = true;
    decision.riskLevel = 'low';
    decision.reasons.push('Clean license - no points');
  } else if (points <= 3) {
    decision.approved = true;
    decision.riskLevel = 'standard';
    decision.reasons.push('Minor points - standard approval');
  } else if (points <= 6) {
    const hasSpeedingOnly = endorsements.every(e => e.code.startsWith('SP'));
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

// Helper functions (unchanged from Session 18)
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

// Enhanced mock data for testing (when AWS not available)
function getEnhancedMockDvlaAnalysis() {
  return {
    licenseNumber: "WOOD661120JO9LA",
    licenseEnding: "JO9LA", // NEW: For anti-fraud validation
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
    issues: ["✅ License ending: JO9LA (anti-fraud ready)", "✅ DVLA check is 26 days old (fresh)"],
    confidence: 85,
    ageInDays: 26,
    extractionSuccess: true,
    insuranceDecision: {
      approved: true,
      excess: 0,
      manualReview: false,
      reasons: ["Minor points - standard approval"],
      riskLevel: "standard"
    },
    extractionDetails: {
      licensePatterns: [{pattern: 0, found: "WOOD661120JO9LA", position: 150}],
      endorsementSources: [{code: "SP30", source: "pattern_1"}],
      dateFormats: [{pattern: 0, original: "21 July 2025", standardized: "2025-07-21"}],
      debugInfo: {
        finalLicenseNumber: "WOOD661120JO9LA",
        finalLicenseEnding: "JO9LA"
      }
    },
    mockMode: true,
    ocrProvider: 'AWS Textract (Enhanced Mock)'
  };
}

// AWS signature creation and other helper functions remain unchanged...
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

// POA processing functions (unchanged)
async function testSinglePoaExtraction(imageData, documentType = 'unknown', licenseAddress = '123 Test Street, London, SW1A 1AA', fileType = 'image') {
  console.log('Testing single POA extraction');
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

function createDvlaFallback(fileType, errorMessage) {
  return {
    licenseNumber: 'FALLBACK751120FB9AB',
    licenseEnding: 'FB9AB',
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
    extractionDetails: {
      licensePatterns: [],
      endorsementSources: [],
      dateFormats: [],
      debugInfo: {
        finalLicenseNumber: 'FALLBACK751120FB9AB',
        finalLicenseEnding: 'FB9AB',
        fallbackMode: true
      }
    },
    fallbackMode: true,
    ocrProvider: 'Fallback'
  };
}
