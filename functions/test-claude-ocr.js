// File: functions/test-claude-ocr.js
// ENHANCED VERSION - Now includes comprehensive DVLA processing
// Allows testing the actual insurance compliance workflow without Idenfy

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Enhanced Claude OCR Test function called');
  
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
          usage: 'testType: "poa", "dvla", or "dual-poa", imageData: base64 string, imageData2: base64 string (for dual-poa)'
        })
      };
    }

    console.log(`Testing ${testType} OCR processing (${fileType || 'image'})`);
    let result;

    switch (testType) {
      case 'poa':
        result = await testSinglePoaExtraction(imageData, documentType, licenseAddress, fileType);
        break;
      case 'dvla':
        result = await testEnhancedDvlaOcrWithFallback(imageData, fileType);
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
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Claude OCR test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Claude OCR test failed',
        details: error.message 
      })
    };
  }
};

// NEW: Test dual POA cross-validation (the actual insurance workflow)
async function testDualPoaCrossValidation(imageData1, imageData2, licenseAddress = '123 Test Street, London, SW1A 1AA', fileType = 'image') {
  console.log('🔄 Testing DUAL POA cross-validation workflow');
  
  // Extract data from both POA documents
  console.log('📄 Analyzing POA Document #1...');
  const poa1Analysis = await extractPoaDocumentData(imageData1, 'POA1', fileType);
  
  console.log('📄 Analyzing POA Document #2...');
  const poa2Analysis = await extractPoaDocumentData(imageData2, 'POA2', fileType);
  
  // Cross-validate the documents (the core insurance requirement)
  console.log('⚖️ Cross-validating POA documents...');
  const crossValidation = performPoaCrossValidation(poa1Analysis, poa2Analysis);
  
  return {
    testType: 'dual-poa',
    poa1: poa1Analysis,
    poa2: poa2Analysis,
    crossValidation: crossValidation,
    overallValid: crossValidation.approved,
    summary: generateValidationSummary(poa1Analysis, poa2Analysis, crossValidation)
  };
}

// Extract data from a single POA document (simplified for our actual needs)
async function extractPoaDocumentData(imageData, documentId, fileType = 'image') {
  // Check if Claude API is configured
  if (!process.env.CLAUDE_API_KEY) {
    console.log('Claude API not configured, using mock POA analysis');
    return getMockPoaData(documentId);
  }

  try {
    console.log(`Extracting data from ${documentId} with Claude OCR`);
    const claudeResult = await attemptClaudeVisionAnalysis(imageData, fileType, createSimplifiedPoaPrompt());
    
    // Validate and clean the extracted data
    const validatedData = validateExtractedPoaData(claudeResult, documentId);
    console.log(`✅ ${documentId} analysis successful`);
    return validatedData;

  } catch (error) {
    console.log(`❌ Claude vision failed for ${documentId}, using fallback:`, error.message);
    
    // Return intelligent fallback
    return createPoaFallback(documentId, fileType);
  }
}

// NEW: Simplified POA prompt focused on what we actually need
function createSimplifiedPoaPrompt() {
  return `Analyze this proof of address document and return ONLY a JSON object:

{
  "documentType": "utility_bill|bank_statement|council_tax|credit_card_statement|payslip|other",
  "providerName": "company or bank name",
  "documentDate": "YYYY-MM-DD when document was issued",
  "accountNumber": "last 4 digits or reference number if visible",
  "confidence": "high|medium|low"
}

Focus on extracting the provider name and document date accurately.
RETURN ONLY JSON, no other text.`;
}

// NEW: Cross-validation logic (the core insurance requirement)
function performPoaCrossValidation(poa1, poa2) {
  console.log('⚖️ PERFORMING CROSS-VALIDATION');
  
  const validation = {
    approved: false,
    issues: [],
    checks: {
      bothExtracted: false,
      differentProviders: false,
      differentDocumentTypes: false,
      differentAccountNumbers: false,
      bothHaveDates: false
    },
    details: {
      poa1Provider: poa1.providerName?.toLowerCase() || 'unknown',
      poa2Provider: poa2.providerName?.toLowerCase() || 'unknown',
      poa1Type: poa1.documentType || 'unknown',
      poa2Type: poa2.documentType || 'unknown',
      poa1Account: poa1.accountNumber || 'none',
      poa2Account: poa2.accountNumber || 'none'
    }
  };

  // Check 1: Both documents extracted successfully
  validation.checks.bothExtracted = !!(poa1.providerName && poa2.providerName);
  if (!validation.checks.bothExtracted) {
    validation.issues.push('❌ Failed to extract data from one or both POA documents');
  }

  // Check 2: Different providers (MAIN INSURANCE REQUIREMENT)
  const sameProvider = poa1.providerName?.toLowerCase() === poa2.providerName?.toLowerCase();
  validation.checks.differentProviders = !sameProvider && poa1.providerName && poa2.providerName;
  
  if (sameProvider && poa1.providerName && poa2.providerName) {
    validation.issues.push(`❌ Both POAs are from the same provider: ${poa1.providerName}`);
  } else if (validation.checks.differentProviders) {
    validation.issues.push(`✅ Different providers: ${poa1.providerName} vs ${poa2.providerName}`);
  }

  // Check 3: Different document types (bonus check)
  validation.checks.differentDocumentTypes = poa1.documentType !== poa2.documentType;
  if (validation.checks.differentDocumentTypes) {
    validation.issues.push(`✅ Different document types: ${poa1.documentType} vs ${poa2.documentType}`);
  }

  // Check 4: Different account numbers (prevents duplicate documents)
  const sameAccount = poa1.accountNumber && poa2.accountNumber && 
                     poa1.accountNumber === poa2.accountNumber &&
                     poa1.accountNumber !== 'none';
  validation.checks.differentAccountNumbers = !sameAccount;
  
  if (sameAccount) {
    validation.issues.push('❌ Same account number detected - possible duplicate documents');
  }

  // Check 5: Both have extractable dates
  validation.checks.bothHaveDates = !!(poa1.documentDate && poa2.documentDate);
  if (!validation.checks.bothHaveDates) {
    validation.issues.push('⚠️ Could not extract dates from one or both documents');
  }

  // Overall approval decision
  validation.approved = 
    validation.checks.bothExtracted &&
    validation.checks.differentProviders &&
    validation.checks.differentAccountNumbers;

  console.log('⚖️ CROSS-VALIDATION RESULT:', validation.approved ? 'APPROVED' : 'REJECTED');
  console.log('⚖️ Issues:', validation.issues.length);

  return validation;
}

// Validate extracted POA data (simplified - no unnecessary checks)
function validateExtractedPoaData(data, documentId) {
  const validatedData = {
    documentId: documentId,
    documentType: data.documentType || 'unknown',
    providerName: data.providerName || 'Unknown Provider',
    documentDate: data.documentDate || null,
    accountNumber: data.accountNumber || 'none',
    confidence: (data.confidence || 'medium').toLowerCase(),
    ageInDays: null,
    extractionSuccess: true,
    issues: []
  };

  // Calculate document age if we have a date
  if (validatedData.documentDate) {
    validatedData.ageInDays = calculateDaysFromDate(validatedData.documentDate);
    console.log(`📅 ${documentId} age: ${validatedData.ageInDays} days`);
  } else {
    validatedData.issues.push('⚠️ No document date found');
  }

  // Basic validation
  if (!validatedData.providerName || validatedData.providerName === 'Unknown Provider') {
    validatedData.issues.push('⚠️ Provider name not clearly identified');
    validatedData.confidence = 'low';
  }

  if (!validatedData.documentType || validatedData.documentType === 'unknown') {
    validatedData.issues.push('⚠️ Document type not identified');
  }

  console.log(`📋 ${documentId} validation complete: ${validatedData.issues.length} issues`);
  return validatedData;
}

// Generate summary for test results
function generateValidationSummary(poa1, poa2, crossValidation) {
  const summary = {
    overallResult: crossValidation.approved ? 'APPROVED' : 'REJECTED',
    keyFindings: [],
    recommendations: []
  };

  if (crossValidation.approved) {
    summary.keyFindings.push('✅ Insurance requirement met: 2 POAs from different sources');
    summary.keyFindings.push(`✅ POA #1: ${poa1.providerName} (${poa1.documentType})`);
    summary.keyFindings.push(`✅ POA #2: ${poa2.providerName} (${poa2.documentType})`);
  } else {
    summary.keyFindings.push('❌ Insurance requirement NOT met');
    if (!crossValidation.checks.differentProviders) {
      summary.recommendations.push('Need POAs from different companies/providers');
    }
    if (!crossValidation.checks.bothExtracted) {
      summary.recommendations.push('Improve document image quality for better OCR extraction');
    }
  }

  return summary;
}

// ENHANCED: DVLA processing with comprehensive data extraction
async function testEnhancedDvlaOcrWithFallback(imageData, fileType = 'image') {
  console.log('🚗 Testing ENHANCED DVLA OCR with comprehensive extraction');
  
  if (!process.env.CLAUDE_API_KEY) {
    console.log('Claude API not configured, using enhanced mock DVLA analysis');
    return getEnhancedMockDvlaAnalysis();
  }

  try {
    console.log('Attempting Claude API for enhanced DVLA analysis...');
    const claudeResult = await attemptClaudeVisionAnalysis(imageData, fileType, createEnhancedDvlaPrompt());
    
    const validatedData = validateEnhancedDvlaData(claudeResult);
    console.log('✅ Enhanced Claude DVLA analysis successful');
    return validatedData;

  } catch (error) {
    console.log('❌ Claude vision failed, using enhanced intelligent fallback:', error.message);
    return createEnhancedDvlaFallback(fileType);
  }
}

// ENHANCED: Comprehensive DVLA prompt
function createEnhancedDvlaPrompt(expectedLicenseNumber) {
  return `Analyze this DVLA driving license check document and extract the following information in JSON format:

{
  "licenseNumber": "extracted license number",
  "driverName": "full name from document",
  "checkCode": "DVLA check code (format: Ab cd ef Gh)",
  "dateGenerated": "YYYY-MM-DD when check was generated",
  "validFrom": "YYYY-MM-DD license valid from",
  "validTo": "YYYY-MM-DD license valid until",
  "drivingStatus": "current status text",
  "endorsements": [
    {
      "code": "endorsement code (SP30, MS90, etc)",
      "date": "YYYY-MM-DD",
      "points": number,
      "description": "description of offense"
    }
  ],
  "totalPoints": number,
  "restrictions": ["any driving restrictions"],
  "categories": ["license categories like B, C1, etc"],
  "isValid": boolean,
  "issues": ["any problems found"],
  "confidence": "high|medium|low"
}

Important notes:
- Look for endorsement codes like SP30 (speeding), MS90 (failure to give information), CU80 (breach of requirements), IN10 (using vehicle uninsured), etc.
- Count total penalty points carefully
- Check if license is currently valid
- Extract the check code exactly as shown
- Look for any disqualifications or restrictions

Expected license number for validation: "${expectedLicenseNumber || 'Not provided'}"

RETURN ONLY JSON, no other text.`;
}

// ENHANCED: Comprehensive DVLA data validation
function validateEnhancedDvlaData(data, expectedLicenseNumber) {
  const validatedData = {
    licenseNumber: data.licenseNumber || 'unknown',
    driverName: data.driverName || 'Unknown',
    checkCode: data.checkCode || null,
    dateGenerated: data.dateGenerated || null,
    validFrom: data.validFrom || null,
    validTo: data.validTo || null,
    drivingStatus: data.drivingStatus || 'Unknown',
    endorsements: data.endorsements || [],
    totalPoints: data.totalPoints || 0,
    restrictions: data.restrictions || [],
    categories: data.categories || [],
    isValid: data.isValid !== false,
    issues: data.issues || [],
    confidence: (data.confidence || 'medium').toLowerCase(),
    ageInDays: null,
    extractionSuccess: true
  };

  // Validation checks
  if (!validatedData.licenseNumber || validatedData.licenseNumber === 'unknown') {
    validatedData.issues.push('❌ License number not found');
    validatedData.confidence = 'low';
    validatedData.isValid = false;
  }

  if (!validatedData.driverName || validatedData.driverName === 'Unknown') {
    validatedData.issues.push('⚠️ Driver name not clearly identified');
    validatedData.confidence = 'low';
  }

  if (!validatedData.checkCode) {
    validatedData.issues.push('⚠️ DVLA check code not found');
  }

  // License number validation against expected
  if (expectedLicenseNumber && validatedData.licenseNumber !== expectedLicenseNumber) {
    validatedData.issues.push('❌ License number mismatch');
    validatedData.isValid = false;
  }

  // Check code format validation (should be like "Ab cd ef Gh")
  if (validatedData.checkCode && !/^[A-Za-z]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}$/.test(validatedData.checkCode)) {
    validatedData.issues.push('⚠️ Invalid DVLA check code format');
  }

  // Calculate document age if generated date available
  if (validatedData.dateGenerated) {
    validatedData.ageInDays = calculateDaysFromDate(validatedData.dateGenerated);
  }

  // NEW: Calculate insurance decision automatically
  validatedData.insuranceDecision = calculateInsuranceDecision(validatedData);

  console.log(`🚗 Enhanced DVLA validation complete: ${validatedData.issues.length} issues, ${validatedData.totalPoints} points`);
  return validatedData;
}

// NEW: Automatic insurance decision calculation
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

  // Check for serious offenses that require manual review
  const seriousOffenses = ['MS90', 'IN10', 'DR10', 'DR20', 'DR30', 'DR40', 'DR50', 'DR60', 'DR70'];
  const hasSeriousOffense = endorsements.some(e => seriousOffenses.includes(e.code));

  if (hasSeriousOffense) {
    decision.manualReview = true;
    decision.reasons.push('Serious driving offense detected - requires underwriter review');
    return decision;
  }

  // Points-based decision logic
  if (points === 0) {
    decision.approved = true;
    decision.riskLevel = 'low';
    decision.reasons.push('Clean license - no points');
  } else if (points <= 3) {
    decision.approved = true;
    decision.riskLevel = 'standard';
    decision.reasons.push('Minor points - standard approval');
  } else if (points <= 6) {
    // Check for specific offense types
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

  // Check for recent offenses (last 12 months)
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

// ENHANCED: Comprehensive mock DVLA data
function getEnhancedMockDvlaAnalysis() {
  return {
    licenseNumber: "WOOD661120JO9LA",
    driverName: "JONATHAN WOOD",
    checkCode: "Kd m3 ch Nn",
    dateGenerated: "2025-07-14",
    validFrom: "2006-08-01",
    validTo: "2032-08-01",
    drivingStatus: "Current full licence",
    endorsements: [
      {
        code: "SP30",
        date: "2023-03-15",
        points: 3,
        description: "Exceeding statutory speed limit on a public road"
      }
    ],
    totalPoints: 3,
    restrictions: [],
    categories: ["B", "BE"],
    isValid: true,
    issues: [],
    confidence: "high",
    ageInDays: 7,
    extractionSuccess: true,
    insuranceDecision: {
      approved: true,
      excess: 0,
      manualReview: false,
      reasons: ["Minor points - standard approval"],
      riskLevel: "standard"
    },
    mockMode: true
  };
}

// ENHANCED: Intelligent DVLA fallback
function createEnhancedDvlaFallback(fileType) {
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
    issues: ['⚠️ Claude API failed - using fallback data'],
    confidence: 'low',
    ageInDays: 0,
    extractionSuccess: false,
    insuranceDecision: {
      approved: true,
      excess: 0,
      manualReview: false,
      reasons: ['Clean license - no points (fallback)'],
      riskLevel: 'low'
    },
    fallbackMode: true
  };
}

// Mock POA data for testing when Claude API not available
function getMockPoaData(documentId) {
  const mockData = {
    POA1: {
      documentId: 'POA1',
      documentType: 'utility_bill',
      providerName: 'British Gas',
      documentDate: '2025-06-15',
      accountNumber: '****1234',
      confidence: 'high',
      ageInDays: 32,
      extractionSuccess: true,
      issues: [],
      mockMode: true
    },
    POA2: {
      documentId: 'POA2',
      documentType: 'bank_statement',
      providerName: 'HSBC Bank',
      documentDate: '2025-06-20',
      accountNumber: '****5678',
      confidence: 'high',
      ageInDays: 27,
      extractionSuccess: true,
      issues: [],
      mockMode: true
    }
  };

  return mockData[documentId] || mockData.POA1;
}

// Fallback POA data
function createPoaFallback(documentId, fileType) {
  return {
    documentId: documentId,
    documentType: 'other',
    providerName: `Sample Provider ${documentId}`,
    documentDate: '2025-06-15',
    accountNumber: 'none',
    confidence: 'low',
    ageInDays: 32,
    extractionSuccess: false,
    issues: ['⚠️ Claude API failed - using fallback data'],
    fallbackMode: true
  };
}

// Keep existing single POA test for basic Claude OCR testing
async function testSinglePoaExtraction(imageData, documentType = 'unknown', licenseAddress = '123 Test Street, London, SW1A 1AA', fileType = 'image') {
  console.log('Testing single POA extraction');
  return await extractPoaDocumentData(imageData, 'Single-POA', fileType);
}

// FIXED: Helper function to calculate days from date string
function calculateDaysFromDate(dateString) {
  try {
    console.log(`=== CALCULATING DAYS FOR: ${dateString} ===`);
    
    let parsedDate;
    
    if (dateString.includes('-')) {
      // YYYY-MM-DD format
      parsedDate = new Date(dateString + 'T00:00:00.000Z');
    } else if (dateString.includes('/')) {
      // DD/MM/YYYY or MM/DD/YYYY format
      const parts = dateString.split('/');
      if (parts.length === 3) {
        let day, month, year;
        
        const part1 = parseInt(parts[0]);
        const part2 = parseInt(parts[1]);
        const part3 = parseInt(parts[2]);
        
        if (part1 > 12) {
          day = part1; month = part2; year = part3;
        } else if (part2 > 12) {
          month = part1; day = part2; year = part3;
        } else {
          day = part1; month = part2; year = part3; // Assume DD/MM/YYYY
        }
        
        if (year < 100) {
          year += (year < 50) ? 2000 : 1900;
        }
        
        parsedDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      }
    } else {
      parsedDate = new Date(dateString);
    }
    
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      return 999;
    }
    
    const today = new Date();
    const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0));
    const diffTime = todayUTC.getTime() - parsedDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
    
  } catch (error) {
    console.error('Date parsing error:', error);
    return 999;
  }
}

// Minimal Claude API call function
async function attemptClaudeVisionAnalysis(imageData, fileType, prompt, maxRetries = 2) {
  const mediaType = fileType === 'pdf' ? 'application/pdf' : 'image/jpeg';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'pdfs-2024-09-25'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 800,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: fileType === 'pdf' ? 'document' : 'image',
                  source: { type: 'base64', media_type: mediaType, data: imageData }
                }
              ]
            },
            { role: 'assistant', content: '{' }
          ]
        })
      });

      if (!response.ok) {
        if (response.status === 529 && attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, attempt * 3000));
          continue;
        }
        throw new Error(`Claude API error (${response.status})`);
      }

      const result = await response.json();
      const responseText = result.content[0].text;
      return JSON.parse('{' + responseText);

    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}
