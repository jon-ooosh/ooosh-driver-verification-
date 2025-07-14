// File: functions/validate-poa-documents.js
// NEW: Claude OCR validation for POA compliance checking

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('POA validation function called');
  
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
    const { email, jobId, poaDocuments, licenseAddress } = JSON.parse(event.body);
    
    if (!email || !jobId || !poaDocuments || poaDocuments.length < 2) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email, jobId, and 2 POA documents are required' })
      };
    }

    console.log('Validating POA documents for:', email, jobId);

    // Process both POA documents with Claude OCR
    const poa1Analysis = await analyzePoaDocument(poaDocuments[0], 'POA1', licenseAddress);
    const poa2Analysis = await analyzePoaDocument(poaDocuments[1], 'POA2', licenseAddress);

    // Cross-validate the documents
    const validationResult = await crossValidatePoaDocuments(poa1Analysis, poa2Analysis, licenseAddress);

    // Update Google Sheets with results
    await updatePoaValidationResults(email, jobId, {
      poa1: poa1Analysis,
      poa2: poa2Analysis,
      validation: validationResult
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        poa1: poa1Analysis,
        poa2: poa2Analysis,
        validation: validationResult,
        message: validationResult.approved ? 'POA documents validated successfully' : 'POA validation failed'
      })
    };

  } catch (error) {
    console.error('POA validation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'POA validation failed',
        details: error.message 
      })
    };
  }
};

// Analyze individual POA document using Claude Vision API
async function analyzePoaDocument(documentImage, documentId, licenseAddress) {
  try {
    console.log(`Analyzing ${documentId} with Claude OCR`);

    // Check if Claude API is configured
    if (!process.env.CLAUDE_API_KEY) {
      console.log('Claude API not configured, using mock POA analysis');
      return getMockPoaAnalysis(documentId);
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Please analyze this proof of address document and extract the following information in JSON format:

{
  "documentType": "utility_bill|bank_statement|council_tax|credit_card_statement|other",
  "providerName": "company/bank name",
  "documentDate": "YYYY-MM-DD format",
  "address": "full address from document",
  "accountNumber": "last 4 digits or reference number",
  "isValid": boolean,
  "ageInDays": number,
  "addressMatches": boolean (compare to license address: "${licenseAddress}"),
  "issues": ["list of any problems found"],
  "confidence": "high|medium|low"
}

Requirements:
- Document must be within 90 days old
- Address must match the license address
- Must be a recognized POA document type
- Must be clearly readable`
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: documentImage
              }
            }
          ]
        }]
      })
    });

    if (!claudeResponse.ok) {
      throw new Error(`Claude API error: ${claudeResponse.status}`);
    }

    const result = await claudeResponse.json();
    const extractedData = JSON.parse(result.content[0].text);

    console.log(`${documentId} analysis completed:`, extractedData);
    return extractedData;

  } catch (error) {
    console.error(`Error analyzing ${documentId}:`, error);
    return {
      documentType: 'unknown',
      isValid: false,
      issues: [`Failed to analyze document: ${error.message}`],
      confidence: 'low'
    };
  }
}

// Cross-validate both POA documents for compliance
async function crossValidatePoaDocuments(poa1, poa2, licenseAddress) {
  console.log('Cross-validating POA documents for compliance');

  const validation = {
    approved: false,
    issues: [],
    compliance: {
      bothValid: false,
      differentTypes: false,
      bothWithin90Days: false,
      addressesMatch: false,
      differentProviders: false
    }
  };

  // Check both documents are valid
  validation.compliance.bothValid = poa1.isValid && poa2.isValid;
  if (!validation.compliance.bothValid) {
    validation.issues.push('One or both POA documents are invalid');
  }

  // Check documents are different types or from different providers
  const sameType = poa1.documentType === poa2.documentType;
  const sameProvider = poa1.providerName?.toLowerCase() === poa2.providerName?.toLowerCase();
  const sameAccount = poa1.accountNumber === poa2.accountNumber;

  validation.compliance.differentTypes = !sameType;
  validation.compliance.differentProviders = !sameProvider;

  if (sameType && sameProvider) {
    validation.issues.push('POA documents must be from different providers or different document types');
  }

  if (sameAccount && poa1.accountNumber) {
    validation.issues.push('POA documents appear to be identical - same account number detected');
  }

  // Check both are within 90 days
  validation.compliance.bothWithin90Days = 
    (poa1.ageInDays <= 90) && (poa2.ageInDays <= 90);
  
  if (!validation.compliance.bothWithin90Days) {
    validation.issues.push('One or both POA documents are older than 90 days');
  }

  // Check addresses match license
  validation.compliance.addressesMatch = poa1.addressMatches && poa2.addressMatches;
  if (!validation.compliance.addressesMatch) {
    validation.issues.push('POA addresses do not match license address');
  }

  // Overall approval
  validation.approved = 
    validation.compliance.bothValid &&
    (validation.compliance.differentTypes || validation.compliance.differentProviders) &&
    validation.compliance.bothWithin90Days &&
    validation.compliance.addressesMatch &&
    !sameAccount;

  console.log('POA validation result:', validation);
  return validation;
}

// Update Google Sheets with POA validation results
async function updatePoaValidationResults(email, jobId, results) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('Google Apps Script URL not configured');
      return;
    }

    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'update-poa-validation',
        email: email,
        jobId: jobId,
        poaResults: results
      })
    });

    if (response.ok) {
      console.log('POA validation results saved to Google Sheets');
    } else {
      console.error('Failed to save POA validation results');
    }

  } catch (error) {
    console.error('Error saving POA validation results:', error);
  }
}

// Mock POA analysis for development
function getMockPoaAnalysis(documentId) {
  const mockData = {
    POA1: {
      documentType: 'utility_bill',
      providerName: 'British Gas',
      documentDate: '2025-06-15',
      address: '123 Test Street, London, SW1A 1AA',
      accountNumber: '1234',
      isValid: true,
      ageInDays: 29,
      addressMatches: true,
      issues: [],
      confidence: 'high'
    },
    POA2: {
      documentType: 'bank_statement',
      providerName: 'HSBC Bank',
      documentDate: '2025-06-20',
      address: '123 Test Street, London, SW1A 1AA',
      accountNumber: '5678',
      isValid: true,
      ageInDays: 24,
      addressMatches: true,
      issues: [],
      confidence: 'high'
    }
  };

  return mockData[documentId] || mockData.POA1;
}
