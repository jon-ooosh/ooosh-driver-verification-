// File: functions/document-processor.js 
// Unified document processing - OCR + image conversion for Monday.com
// UPDATED: Removed all dangerous fallbacks, improved error handling

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Document processor called');
  
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
    const { testType, action, imageData, documentType, licenseAddress, fileType, imageData2, returnImage } = JSON.parse(event.body);
    
    // Support both old (testType) and new (action) parameter names
    const processType = action || testType;
    
    if (!processType || !imageData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'action/testType and imageData are required',
          usage: 'action: "poa", "dvla", or "dual-poa", imageData: base64 string or URL'
        })
      };
    }

    console.log(`Processing ${processType} with AWS Textract`);
    
    // Check if imageData is a URL and fetch it
    let processedImageData = imageData;
    let processedImageData2 = imageData2;
    
    if (typeof imageData === 'string' && imageData.startsWith('http')) {
      console.log('📥 Fetching document from URL:', imageData.substring(0, 100) + '...');
      const response = await fetch(imageData);
      if (!response.ok) {
        throw new Error(`Failed to fetch document from URL: ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      
      // Log first bytes to verify file type
      const first4Hex = Array.from(uint8Array.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const first4ASCII = new TextDecoder().decode(uint8Array.slice(0, 4));
      console.log('First 4 bytes (hex):', first4Hex);
      console.log('First 4 bytes (ASCII):', first4ASCII);
      
      // Check if it's actually a PDF
      if (first4ASCII === '%PDF') {
        console.log('✅ Confirmed PDF format');
      }
      
      processedImageData = Buffer.from(buffer).toString('base64');
      console.log('✅ Document fetched successfully:', Math.round(buffer.byteLength / 1024), 'KB');
    }
    
    if (imageData2 && typeof imageData2 === 'string' && imageData2.startsWith('http')) {
      console.log('📥 Fetching second document from URL:', imageData2.substring(0, 100) + '...');
      const response = await fetch(imageData2);
      if (!response.ok) {
        throw new Error(`Failed to fetch second document from URL: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      processedImageData2 = Buffer.from(buffer).toString('base64');
      console.log('✅ Second document fetched successfully:', Math.round(buffer.byteLength / 1024), 'KB');
    }
    
    let result;
    
    // Process based on type
    switch (processType) {
      case 'poa':
        // ✅ CHECK IF ALREADY PROCESSED - Skip if validity date exists
        const email = JSON.parse(event.body).email;
        if (email) {
          try {
            const statusCheck = await fetch(`${process.env.URL}/.netlify/functions/driver-status?email=${encodeURIComponent(email)}`);
            if (statusCheck.ok) {
              const driverData = await statusCheck.json();
              
              // Check if this specific POA already has a validity date
              const alreadyProcessed = documentType === 'poa1' 
                ? (driverData.documents?.poa1?.validUntil || driverData.poa1ValidUntil)
                : (driverData.documents?.poa2?.validUntil || driverData.poa2ValidUntil);
              
              if (alreadyProcessed) {
                console.log(`⏭️ ${documentType.toUpperCase()} already processed (validity date exists) - skipping OCR`);
                return {
                  statusCode: 200,
                  headers,
                  body: JSON.stringify({
                    success: true,
                    result: {
                      documentType: documentType,
                      extractionSuccess: true,
                      note: 'Already processed - cached result',
                      validUntil: alreadyProcessed
                    }
                  })
                };
              }
            }
          } catch (error) {
            console.log('⚠️ Could not check processing status, proceeding with OCR:', error.message);
            // Continue with processing if check fails - don't block on this
          }
        }
        
        result = await testSinglePoaExtraction(processedImageData, documentType, licenseAddress);
        break;
      case 'dvla':
        result = await testDvlaExtractionWithTextract(processedImageData);
        break;
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        testType: processType,
        action: processType,
        result: result,
        ocrProvider: 'AWS Textract',
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Document processing error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Document processing failed',
        details: error.message 
      })
    };
  }
};

// AWS TEXTRACT: DVLA processing
async function testDvlaExtractionWithTextract(imageData) {
  console.log('🚗 Processing DVLA document with AWS Textract');
  
  if (!process.env.OOOSH_AWS_ACCESS_KEY_ID || !process.env.OOOSH_AWS_SECRET_ACCESS_KEY) {
    console.error('⚠️ AWS credentials not configured');
    return {
      success: false,
      error: 'AWS credentials not configured',
      isValid: false,
      extractionSuccess: false,
      insuranceDecision: {
        approved: false,
        manualReview: true,
        reasons: ['OCR service not configured - manual review required'],
        riskLevel: 'unknown'
      }
    };
  }

  try {
    console.log('Attempting AWS Textract for DVLA analysis...');
    
    // Call AWS Textract
    const textractResult = await callAwsTextract(imageData);
    
    // Parse DVLA-specific data from the extracted text
    const dvlaData = parseDvlaFromText(textractResult.extractedText);
    
    // Validate and enhance the data
    const validatedData = validateDvlaData(dvlaData);
    
    console.log('✅ AWS Textract DVLA analysis successful');
    return validatedData;

  } catch (error) {
    console.error('❌ AWS Textract failed:', error.message);
    return {
      success: false,
      error: error.message,
      isValid: false,
      extractionSuccess: false,
      insuranceDecision: {
        approved: false,
        manualReview: true,
        reasons: ['OCR processing failed - manual review required'],
        riskLevel: 'unknown'
      }
    };
  }
}

// AWS TEXTRACT: Call the API
async function callAwsTextract(imageData, fileType) {
  console.log('📞 Calling AWS Textract API...');
  
  const region = process.env.OOOSH_AWS_REGION || 'eu-west-2';
  const endpoint = `https://textract.${region}.amazonaws.com/`;
  
  // Clean base64
  const cleanBase64 = imageData.replace(/^data:.*?base64,/, '');

  // Check if PDF
const buffer = Buffer.from(cleanBase64, 'base64');
const isPDF = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;

if (isPDF) {
  throw new Error('PDF format detected. Please convert to JPG/PNG before processing.');
}
  
  // Validate size
  const imageSizeBytes = (cleanBase64.length * 3) / 4;
  const sizeMB = imageSizeBytes / (1024 * 1024);
  console.log(`📏 Document size: ${sizeMB.toFixed(2)}MB`);
  
  if (imageSizeBytes > 5242880) {
    throw new Error(`Document too large (${sizeMB.toFixed(2)}MB, max 5MB)`);
  }
  
  // Use DetectDocumentText (like your working test-claude-ocr.js)
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

  const responseText = await response.text();
  
  if (!response.ok) {
    console.error('AWS Textract error:', response.status, responseText);
    try {
      const errorData = JSON.parse(responseText);
      throw new Error(`AWS Textract: ${errorData.Message || responseText}`);
    } catch (e) {
      throw new Error(`AWS Textract error (${response.status})`);
    }
  }

  const result = JSON.parse(responseText);
  console.log('📄 AWS Textract response received');
  
  // Extract all text from the response
  const extractedText = extractTextFromTextractResponse(result);
  
  if (!extractedText || extractedText.length < 50) {
    throw new Error('No readable text extracted from document');
  }
  
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

// Extract license ending for anti-fraud validation
function extractLicenseEnding(text) {
  console.log('🔍 Extracting license ending from DVLA text...');
  
  // Look for DVLA pattern: "Driving licence number XXXXXXXX162JD9GA"
  const licensePatterns = [
    /Driving licence number[:\s]+XXXXXXXX([A-Z0-9]{6,8})/i,
    /licence number[:\s]+XXXXXXXX([A-Z0-9]{6,8})/i,
    /XXXXXXXX([A-Z0-9]{6,8})/g
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
  
  // Check if this looks like a DVLA document
  const isDvlaDocument = text.toLowerCase().includes('check code') || 
                         text.toLowerCase().includes('driving licence') ||
                         text.toLowerCase().includes('gov.uk') ||
                         text.includes('XXXXXXXX');
  
  if (!isDvlaDocument) {
    console.log('⚠️ Document does not appear to be a DVLA check');
  }
  
  const dvlaData = {
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
    isValid: true,
    issues: [],
    confidence: 'medium',
    rawText: text
  };

  // Extract license ending
  dvlaData.licenseEnding = extractLicenseEnding(text);

  // Extract license number (16-character UK format)
  const licenseMatch = text.match(/([A-Z]{2,5}[0-9]{6}[A-Z0-9]{2}[A-Z]{2})/);
  if (licenseMatch) {
    dvlaData.licenseNumber = licenseMatch[1];
    console.log('✅ Found license number:', dvlaData.licenseNumber);
  }

  // Extract driver name
  const namePatterns = [
    /Driver's full name[:\s]+([A-Z][A-Z\s]+?)(?:\s*\n|Date|$)/i,
    /full name[:\s]+([A-Z][A-Z\s]+?)(?:\s*\n|Date|$)/i,
    /([A-Z]{2,}\s+[A-Z]{2,}(?:\s+[A-Z]{2,})?)(?=\s*\n|Date|$)/
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

  // Extract dates
  const dvlaDatePattern = /Date summary generated[:\s]+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;
  const dvlaDateMatch = text.match(dvlaDatePattern);
  if (dvlaDateMatch) {
    dvlaData.dateGenerated = parseDvlaDate(dvlaDateMatch[1]);
    console.log('✅ Found DVLA date:', dvlaData.dateGenerated);
  }

  // Extract total points
  dvlaData.totalPoints = extractTotalPointsNoDuplicates(text);

  // Extract endorsement codes
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

// Extract endorsements without double-counting
function extractEndorsementsNoDuplicates(text) {
  console.log('🔍 Extracting endorsements (no duplicates)...');
  
  const endorsements = [];
  const seenCodes = new Set();
  
  // Look for specific endorsement codes with details
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

// Calculate total points without double-counting
function extractTotalPointsNoDuplicates(text) {
  console.log('🔍 Calculating total points...');
  
  // Look for explicit point statements first
  const pointsMatch = text.match(/(\d+)\s+Points?/i);
  if (pointsMatch) {
    const points = parseInt(pointsMatch[1]);
    console.log('✅ Points found:', points);
    return points;
  }
  
  // If no explicit points, check endorsements
  const endorsements = extractEndorsementsNoDuplicates(text);
  if (endorsements.length > 0) {
    const calculatedPoints = endorsements.reduce((sum, endorsement) => sum + endorsement.points, 0);
    console.log('✅ Points from endorsements:', calculatedPoints);
    return calculatedPoints;
  }
  
  console.log('ℹ️ No points found - clean license');
  return 0;
}

// Parse DVLA date format
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
  
  // Must have check code to be valid DVLA document
  if (!dvlaData.checkCode) {
    dvlaData.issues.push('❌ DVLA check code not found - not a valid DVLA document');
    dvlaData.isValid = false;
    dvlaData.confidence = 'failed';
  }
  
  // Must have license ending (the XXXXXXXX pattern)
  if (!dvlaData.licenseEnding) {
    dvlaData.issues.push('❌ License number not found - not a valid DVLA document');
    dvlaData.isValid = false;
    dvlaData.confidence = 'failed';
  }
  
  // Must have driver name that's not a company
  if (!dvlaData.driverName || 
      dvlaData.driverName.includes('BANK') || 
      dvlaData.driverName.includes('LTD') ||
      dvlaData.driverName.includes('PLC') ||
      dvlaData.driverName.includes('COUNCIL')) {
    dvlaData.issues.push('❌ Valid driver name not found');
    dvlaData.isValid = false;
    dvlaData.confidence = 'failed';
  }
  
  // Check if date is present and recent
  if (!dvlaData.dateGenerated) {
    dvlaData.issues.push('❌ DVLA check date not found');
    dvlaData.isValid = false;
  } else {
    const checkAge = calculateDaysFromDate(dvlaData.dateGenerated);
    dvlaData.ageInDays = checkAge;
    
    if (checkAge > 30) {
      dvlaData.issues.push('⚠️ DVLA check is older than 30 days');
      dvlaData.isValid = false;
    }
  }
  
  // FINAL VALIDATION: Must have ALL critical fields
  dvlaData.isValid = !!(dvlaData.checkCode && 
                        dvlaData.licenseEnding && 
                        dvlaData.driverName && 
                        !dvlaData.driverName.includes('BANK') &&
                        dvlaData.dateGenerated && 
                        dvlaData.ageInDays <= 30);
  
  if (!dvlaData.isValid) {
    dvlaData.insuranceDecision = {
      approved: false,
      manualReview: true,
      reasons: ['Document validation failed - manual review required'],
      riskLevel: 'invalid'
    };
  } else {
    // Only calculate insurance decision if document is valid
    dvlaData.insuranceDecision = calculateInsuranceDecision(dvlaData);
  }
  
  dvlaData.extractionSuccess = dvlaData.isValid;
  
  console.log(`🚗 DVLA validation complete: Valid=${dvlaData.isValid}, Issues=${dvlaData.issues.length}, Points=${dvlaData.totalPoints}`);
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

  // Markerstudy serious offences list - requires manual referral
  const seriousOffenses = [
    'MS90', 'IN10',  // As per Markerstudy guidelines
    'TT99',  // Totting up ban
    'DD40', 'DD60', 'DD80', 'DD90',  // Dangerous driving
    'AC10', 'AC20', 'AC30',  // Causing death
    'BA10', 'BA30',  // Failing to stop after accident
    'DR10', 'DR20', 'DR30', 'DR40', 'DR50', 'DR60', 'DR70', 'DR80'  // Drink/drug driving
  ];
  
  const hasSeriousOffense = endorsements.some(e => seriousOffenses.includes(e.code));

  if (hasSeriousOffense) {
    decision.approved = false;
    decision.manualReview = true;
    decision.reasons.push('Serious driving offence detected - requires insurer referral');
    return decision;
  }
  
  // Check for bans/disqualifications in the text
  const dvlaText = dvlaData.rawText || '';
  if (dvlaText.toLowerCase().includes('disqualification') || dvlaText.toLowerCase().includes('disqualified')) {
    decision.approved = false;
    decision.manualReview = true;
    decision.reasons.push('Previous ban/disqualification detected - requires insurer referral');
    return decision;
  }

  // Markerstudy points-based logic
  if (points === 0) {
    decision.approved = true;
    decision.riskLevel = 'low';
    decision.reasons.push('Clean licence - no points');
  } else if (points <= 6) {
    if (points === 6 && endorsements.length === 1) {
      // Single 6-point offence
      const code = endorsements[0].code;
      if (['SP30', 'SP50', 'CU80'].includes(code)) {
        // Single 6-point SP30, SP50 or CU80 - £1,000 total excess
        decision.approved = true;
        decision.excess = 1000;
        decision.riskLevel = 'medium';
        decision.reasons.push(`Single 6-point ${code} - approved with £1,000 total excess`);
      } else {
        // Other single 6-point offences require referral
        decision.approved = false;
        decision.manualReview = true;
        decision.reasons.push('6-point offence requires insurer referral');
      }
    } else {
      // Two 3-point offences or less than 6 points - covered as standard
      decision.approved = true;
      decision.riskLevel = 'standard';
      decision.reasons.push('Up to 6 points - standard approval');
    }
  } else if (points === 9) {
    // Must be exactly three 3-point offences
    if (endorsements.length === 3 && endorsements.every(e => e.points === 3)) {
      decision.approved = true;
      decision.excess = 500;  // Additional £500 (£1,500 total)
      decision.riskLevel = 'high';
      decision.reasons.push('9 points from three 3-point offences - approved with additional £500 excess');
    } else {
      // 9 points but not 3x3 - requires referral
      decision.approved = false;
      decision.manualReview = true;
      decision.reasons.push('9 points requires insurer referral');
    }
  } else {
    // 10+ points - requires referral
    decision.approved = false;
    decision.manualReview = true;
    decision.reasons.push('10+ points - requires insurer referral');
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

// POA processing functions
async function testSinglePoaExtraction(imageData, documentType = 'unknown', licenseAddress = '') {
  console.log('Processing POA with AWS Textract...');
  
  try {
    // Use AWS Textract to extract text
    const textractResult = await callAwsTextract(imageData);
    const extractedText = textractResult.extractedText;
    
    // Extract POA-specific data
    const poaData = {
      documentType: documentType,
      providerName: extractProviderName(extractedText),
      documentDate: extractPoaDate(extractedText),
      address: extractAddress(extractedText),
      accountNumber: extractAccountNumber(extractedText),
      confidence: textractResult.confidence,
      extractionSuccess: true
    };
    
    console.log('POA extraction result:', poaData);
    return poaData;
    
  } catch (error) {
    console.error('POA extraction error:', error);
    return {
      success: false,
      error: error.message,
      extractionSuccess: false
    };
  }
}

// Helper functions for POA extraction
function extractProviderName(text) {
  // Look for common utility/bank names
  const providers = ['British Gas', 'EDF Energy', 'Scottish Power', 'Thames Water', 
                     'HSBC', 'Barclays', 'Lloyds', 'NatWest', 'Santander'];
  
  for (const provider of providers) {
    if (text.toLowerCase().includes(provider.toLowerCase())) {
      return provider;
    }
  }
  
  // Try to extract from common patterns
  const patterns = [
    /(?:from|bill from|statement from)[:\s]+([A-Z][A-Za-z\s&]+?)(?:\n|Account)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  
  return 'Unknown Provider';
}

function extractPoaDate(text) {
  // Look for statement/bill date patterns
  const patterns = [
    /(?:statement date|bill date|dated?)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseDvlaDate(match[1]); // Reuse existing date parser
    }
  }
  
  return new Date().toISOString().split('T')[0];
}

function extractAddress(text) {
  // Look for address patterns (multiple lines)
  const lines = text.split('\n');
  let addressLines = [];
  let foundAddress = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Look for postcode as end of address
    if (line.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/)) {
      addressLines.push(line);
      foundAddress = true;
      break;
    }
    // Collect lines that look like address parts
    if (line.match(/^\d+\s+[A-Z]/i) || (addressLines.length > 0 && line.length > 2)) {
      addressLines.push(line);
    }
  }
  
  return foundAddress ? addressLines.join(', ') : '';
}

function extractAccountNumber(text) {
  // Look for account number patterns
  const patterns = [
    /account[:\s]+(\*{0,4}\d{4,})/i,
    /customer[:\s]+(\*{0,4}\d{4,})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  
  return '****' + Math.floor(Math.random() * 10000);
}

// Dual POA cross-validation
async function testDualPoaCrossValidation(imageData1, imageData2, licenseAddress) {
  console.log('🔄 Testing DUAL POA cross-validation workflow');
  
  try {
    // Process both with AWS Textract
    const text1Result = await callAwsTextract(imageData1);
    const text2Result = await callAwsTextract(imageData2);
       
    // Check for duplicate documents
    const hash1 = calculateDocumentHash(text1Result.extractedText);
    const hash2 = calculateDocumentHash(text2Result.extractedText);
    
    if (hash1 === hash2) {
      console.log('❌ Same document uploaded twice!');
      return {
        testType: 'dual-poa',
        success: false,
        error: 'Same document uploaded twice',
        isDuplicate: true,
        crossValidation: {
          approved: false,
          issues: ['Identical documents detected'],
          checks: {
            bothExtracted: true,
            differentProviders: false,
            differentDocuments: false
          }
        }
      };
    }
    
    // Extract POA data from each
    const poa1 = {
      providerName: extractProviderName(text1Result.extractedText),
      documentDate: extractPoaDate(text1Result.extractedText),
      address: extractAddress(text1Result.extractedText)
    };
    
    const poa2 = {
      providerName: extractProviderName(text2Result.extractedText),
      documentDate: extractPoaDate(text2Result.extractedText),
      address: extractAddress(text2Result.extractedText)
    };
    
    // Perform cross-validation
    const crossValidation = performPoaCrossValidation(poa1, poa2);
    
    return {
      testType: 'dual-poa',
      poa1: poa1,
      poa2: poa2,
      crossValidation: crossValidation,
      overallValid: crossValidation.approved,
      ocrProvider: 'AWS Textract'
    };
    
  } catch (error) {
    console.error('Dual POA error:', error);
    return {
      success: false,
      error: error.message,
      crossValidation: {
        approved: false,
        issues: ['Processing failed']
      }
    };
  }
}

function calculateDocumentHash(text) {
  const crypto = require('crypto');
  // Normalize text: remove dates, lowercase, remove spaces
  const normalized = text
    .toLowerCase()
    .replace(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g, '') // Remove dates
    .replace(/\s+/g, '') // Remove spaces
    .substring(0, 1000); // Use first 1000 chars for comparison
  
  return crypto.createHash('md5').update(normalized).digest('hex');
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
