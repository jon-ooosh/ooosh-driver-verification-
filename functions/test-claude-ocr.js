// File: functions/test-claude-ocr.js
// ENHANCED VERSION - Now includes dual POA cross-validation testing
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
        result = await testDvlaOcrWithFallback(imageData, fileType);
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

// Keep existing DVLA test functionality
async function testDvlaOcrWithFallback(imageData, fileType = 'image') {
  console.log('Testing DVLA OCR with fallback strategy');
  
  if (!process.env.CLAUDE_API_KEY) {
    console.log('Claude API not configured, using mock DVLA analysis');
    return getMockDvlaAnalysis();
  }

  try {
    console.log('Attempting Claude API for DVLA analysis...');
    const claudeResult = await attemptClaudeVisionAnalysis(imageData, fileType, createDvlaPrompt(fileType));
    
    const validatedData = validateDvlaData(claudeResult);
    console.log('✅ Claude DVLA analysis successful');
    return validatedData;

  } catch (error) {
    console.log('❌ Claude vision failed, using intelligent fallback:', error.message);
    return createIntelligentDvlaFallback(fileType);
  }
}

// [Keep all existing helper functions: attemptClaudeVisionAnalysis, calculateDaysFromDate, createDvlaPrompt, etc.]
// ... (I'll include the essential ones here to keep this focused)

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

// Basic DVLA functions (keeping minimal for completeness)
function createDvlaPrompt(fileType) {
  return `Analyze this DVLA check document and return ONLY a JSON object:
{
  "licenseNumber": "extracted number",
  "driverName": "name from document", 
  "totalPoints": number,
  "isValid": boolean,
  "confidence": "high|medium|low"
}
RETURN ONLY JSON, no other text.`;
}

function validateDvlaData(data) {
  return {
    licenseNumber: data.licenseNumber || 'unknown',
    driverName: data.driverName || 'Unknown',
    totalPoints: data.totalPoints || 0,
    isValid: data.isValid !== false,
    confidence: (data.confidence || 'medium').toLowerCase()
  };
}

function getMockDvlaAnalysis() {
  return {
    licenseNumber: 'SMITH751120JS9AB',
    driverName: 'JOHN SMITH',
    totalPoints: 3,
    isValid: true,
    confidence: 'high',
    mockMode: true
  };
}

function createIntelligentDvlaFallback(fileType) {
  return {
    licenseNumber: 'FALLBACK751120FB9AB',
    driverName: 'Fallback Driver',
    totalPoints: 0,
    isValid: true,
    confidence: 'low',
    fallbackMode: true
  };
}
