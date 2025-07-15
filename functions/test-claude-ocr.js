// File: functions/test-claude-ocr.js
// STANDALONE Claude OCR Test Function
// Test POA and DVLA document processing independently without full verification flow

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Claude OCR Test function called');
  
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
    const { testType, imageData, documentType, licenseAddress } = JSON.parse(event.body);
    
    if (!testType || !imageData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'testType and imageData are required',
          usage: 'testType: "poa" or "dvla", imageData: base64 string'
        })
      };
    }

    console.log(`Testing ${testType} OCR processing`);
    let result;

    switch (testType) {
      case 'poa':
        result = await testPoaOcr(imageData, documentType, licenseAddress);
        break;
      case 'dvla':
        result = await testDvlaOcr(imageData);
        break;
      default:
        throw new Error('Invalid testType. Use "poa" or "dvla"');
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

// Test POA document OCR
async function testPoaOcr(imageData, documentType = 'unknown', licenseAddress = '123 Test Street, London, SW1A 1AA') {
  console.log('Testing POA OCR with Claude Vision API');
  
  // Check if Claude API is configured
  if (!process.env.CLAUDE_API_KEY) {
    console.log('Claude API not configured, returning mock POA analysis');
    return getMockPoaAnalysis();
  }

  try {
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022', // Latest Claude model with vision
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Please analyze this proof of address document and extract the following information in JSON format:

{
  "documentType": "utility_bill|bank_statement|council_tax|credit_card_statement|mortgage_statement|insurance_statement|mobile_phone_bill|other",
  "providerName": "company/bank name exactly as shown",
  "documentDate": "YYYY-MM-DD format (date of statement/bill)",
  "address": "full address from document exactly as shown",
  "accountHolderName": "name on the account/bill",
  "accountNumber": "last 4 digits or reference number if visible",
  "totalAmount": "bill total if applicable",
  "isValid": boolean,
  "ageInDays": number (calculate from documentDate to today),
  "addressMatches": boolean,
  "issues": ["list of any problems found"],
  "confidence": "high|medium|low",
  "extractedText": "key text visible on document for verification"
}

CRITICAL REQUIREMENTS:
- Document must be within 90 days old (ageInDays <= 90)
- Address must match the expected license address: "${licenseAddress}"
- Must be a recognized POA document type
- Must be clearly readable and not blurred/corrupted
- Must show account holder name and address clearly

Compare the extracted address with license address "${licenseAddress}" - they should be substantially the same (allowing for minor formatting differences).

If you cannot read the document clearly, set confidence to "low" and list specific issues.`
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageData
              }
            }
          ]
        }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      throw new Error(`Claude API error (${claudeResponse.status}): ${errorText}`);
    }

    const result = await claudeResponse.json();
    console.log('Raw Claude response:', JSON.stringify(result, null, 2));
    
    // Extract JSON from Claude's response
    const extractedData = extractJsonFromResponse(result.content[0].text);
    
    // Validate and enhance the extracted data
    const validatedData = validatePoaData(extractedData, licenseAddress);
    
    console.log('POA OCR analysis completed:', validatedData);
    return validatedData;

  } catch (error) {
    console.error('Error in POA OCR:', error);
    return {
      documentType: 'error',
      isValid: false,
      issues: [`Failed to analyze document: ${error.message}`],
      confidence: 'low',
      error: error.message
    };
  }
}

// Test DVLA document OCR
async function testDvlaOcr(imageData) {
  console.log('Testing DVLA OCR with Claude Vision API');
  
  // Check if Claude API is configured
  if (!process.env.CLAUDE_API_KEY) {
    console.log('Claude API not configured, returning mock DVLA analysis');
    return getMockDvlaAnalysis();
  }

  try {
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022', // Latest Claude model with vision
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Please analyze this DVLA driving license check document and extract the following information in JSON format:

{
  "licenseNumber": "extracted license number",
  "driverName": "full name from document",
  "checkCode": "DVLA check code (format: Ab cd ef Gh)",
  "dateGenerated": "YYYY-MM-DD when check was generated",
  "validFrom": "YYYY-MM-DD license valid from",
  "validTo": "YYYY-MM-DD license valid until",
  "drivingStatus": "current status text (e.g., 'Current full licence')",
  "endorsements": [
    {
      "code": "endorsement code (SP30, MS90, etc)",
      "date": "YYYY-MM-DD",
      "points": number,
      "description": "description of offense"
    }
  ],
  "totalPoints": number,
  "restrictions": ["any driving restrictions listed"],
  "categories": ["license categories like B, C1, etc"],
  "isValid": boolean,
  "issues": ["any problems found"],
  "confidence": "high|medium|low",
  "insuranceDecision": {
    "approved": boolean,
    "excess": number,
    "manualReview": boolean,
    "reasons": ["explanation of decision"],
    "riskLevel": "low|standard|medium|high"
  }
}

IMPORTANT NOTES:
- Look for endorsement codes like SP30 (speeding), MS90 (failure to give information), CU80 (breach of requirements), IN10 (using vehicle uninsured), etc.
- Count total penalty points carefully from all endorsements
- Check if license is currently valid and not expired
- Extract the check code exactly as shown (should be format like "Kd m3 ch Nn")
- Look for any disqualifications or restrictions

INSURANCE DECISION LOGIC:
- 0-3 points: Approve, standard risk
- 4-6 points: Conditional approval (check offense types)
  - Speeding only (SP codes): Approve with medium risk
  - Mixed offenses: Manual review required
- 7-9 points: Approve with £500 excess, high risk
- 10+ points: Reject, exceeds limits
- Serious offenses (MS90, IN10, DR10-DR70): Manual review required

If you cannot read the document clearly, set confidence to "low" and list specific issues.`
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageData
              }
            }
          ]
        }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      throw new Error(`Claude API error (${claudeResponse.status}): ${errorText}`);
    }

    const result = await claudeResponse.json();
    console.log('Raw Claude response:', JSON.stringify(result, null, 2));
    
    // Extract JSON from Claude's response
    const extractedData = extractJsonFromResponse(result.content[0].text);
    
    // Validate and enhance the extracted data
    const validatedData = validateDvlaData(extractedData);
    
    console.log('DVLA OCR analysis completed:', validatedData);
    return validatedData;

  } catch (error) {
    console.error('Error in DVLA OCR:', error);
    return {
      licenseNumber: 'unknown',
      isValid: false,
      issues: [`Failed to analyze DVLA document: ${error.message}`],
      confidence: 'low',
      error: error.message
    };
  }
}

// Extract JSON from Claude's response (handles both pure JSON and text with JSON)
function extractJsonFromResponse(responseText) {
  try {
    // Try parsing as direct JSON first
    return JSON.parse(responseText);
  } catch (e) {
    // Extract JSON from markdown code blocks or mixed text
    const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                     responseText.match(/(\{[\s\S]*\})/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    
    throw new Error('No valid JSON found in Claude response');
  }
}

// Validate POA data and add insurance compliance logic
function validatePoaData(data, expectedAddress) {
  // Set defaults for missing fields
  const validatedData = {
    documentType: data.documentType || 'unknown',
    providerName: data.providerName || 'Unknown',
    documentDate: data.documentDate || null,
    address: data.address || '',
    accountHolderName: data.accountHolderName || '',
    accountNumber: data.accountNumber || '',
    totalAmount: data.totalAmount || null,
    isValid: data.isValid || false,
    ageInDays: data.ageInDays || 999,
    addressMatches: data.addressMatches || false,
    issues: data.issues || [],
    confidence: data.confidence || 'low',
    extractedText: data.extractedText || '',
    error: data.error || null
  };

  // Additional validation logic
  if (!validatedData.documentType || validatedData.documentType === 'unknown') {
    validatedData.issues.push('Could not determine document type');
    validatedData.isValid = false;
  }

  if (validatedData.ageInDays > 90) {
    validatedData.issues.push('Document is older than 90 days');
    validatedData.isValid = false;
  }

  if (!validatedData.addressMatches) {
    validatedData.issues.push('Address does not match license address');
    validatedData.isValid = false;
  }

  if (!validatedData.accountHolderName) {
    validatedData.issues.push('No account holder name found');
    validatedData.confidence = 'low';
  }

  // Check for acceptable document types
  const acceptableTypes = [
    'utility_bill', 'bank_statement', 'council_tax', 'credit_card_statement',
    'mortgage_statement', 'insurance_statement', 'mobile_phone_bill'
  ];
  
  if (!acceptableTypes.includes(validatedData.documentType)) {
    validatedData.issues.push('Document type not acceptable for POA');
    validatedData.isValid = false;
  }

  return validatedData;
}

// Validate DVLA data and add insurance decision logic
function validateDvlaData(data) {
  const validatedData = {
    licenseNumber: data.licenseNumber || 'unknown',
    driverName: data.driverName || 'Unknown',
    checkCode: data.checkCode || '',
    dateGenerated: data.dateGenerated || null,
    validFrom: data.validFrom || null,
    validTo: data.validTo || null,
    drivingStatus: data.drivingStatus || 'Unknown',
    endorsements: data.endorsements || [],
    totalPoints: data.totalPoints || 0,
    restrictions: data.restrictions || [],
    categories: data.categories || [],
    isValid: data.isValid !== false, // Default to true unless explicitly false
    issues: data.issues || [],
    confidence: data.confidence || 'medium',
    insuranceDecision: data.insuranceDecision || null,
    error: data.error || null
  };

  // Enhanced validation
  if (!validatedData.licenseNumber || validatedData.licenseNumber === 'unknown') {
    validatedData.issues.push('License number not found');
    validatedData.isValid = false;
  }

  if (!validatedData.checkCode) {
    validatedData.issues.push('DVLA check code not found');
    validatedData.confidence = 'low';
  }

  // Validate check code format (should be like "Kd m3 ch Nn")
  if (validatedData.checkCode && !/^[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}$/.test(validatedData.checkCode)) {
    validatedData.issues.push('Invalid DVLA check code format');
  }

  // Generate insurance decision if not provided
  if (!validatedData.insuranceDecision) {
    validatedData.insuranceDecision = calculateInsuranceDecision(validatedData);
  }

  return validatedData;
}

// Calculate insurance decision based on DVLA data
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
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  
  const recentOffenses = endorsements.filter(e => {
    if (!e.date) return false;
    const offenseDate = new Date(e.date);
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

// Mock POA analysis for development/testing
function getMockPoaAnalysis() {
  return {
    documentType: 'utility_bill',
    providerName: 'British Gas',
    documentDate: '2025-06-15',
    address: '123 Test Street, London, SW1A 1AA',
    accountHolderName: 'John Smith',
    accountNumber: '****1234',
    totalAmount: '£156.78',
    isValid: true,
    ageInDays: 29,
    addressMatches: true,
    issues: [],
    confidence: 'high',
    extractedText: 'Gas Bill - Account ending 1234 - £156.78 - Due 15 Jul 2025',
    mockMode: true
  };
}

// Mock DVLA analysis for development/testing
function getMockDvlaAnalysis() {
  return {
    licenseNumber: 'SMITH751120JS9AB',
    driverName: 'JOHN SMITH',
    checkCode: 'Kd m3 ch Nn',
    dateGenerated: '2025-07-14',
    validFrom: '2006-08-01',
    validTo: '2032-08-01',
    drivingStatus: 'Current full licence',
    endorsements: [
      {
        code: 'SP30',
        date: '2023-03-15',
        points: 3,
        description: 'Exceeding statutory speed limit on a public road'
      }
    ],
    totalPoints: 3,
    restrictions: [],
    categories: ['B', 'BE'],
    isValid: true,
    issues: [],
    confidence: 'high',
    insuranceDecision: {
      approved: true,
      excess: 0,
      manualReview: false,
      reasons: ['Minor points - standard approval'],
      riskLevel: 'standard'
    },
    mockMode: true
  };
}
