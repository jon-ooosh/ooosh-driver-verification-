// File: functions/process-dvla-check.js
// NEW: DVLA Check processor using Claude OCR
// Extracts points, endorsements, and driving status from DVLA check screenshots

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('DVLA check processor called');
  
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
    const { email, jobId, dvlaImage, licenseNumber } = JSON.parse(event.body);
    
    if (!email || !jobId || !dvlaImage) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email, jobId, and DVLA image are required' })
      };
    }

    console.log('Processing DVLA check for:', email, jobId);

    // Process DVLA document with Claude OCR
    const dvlaAnalysis = await analyzeDvlaDocument(dvlaImage, licenseNumber);

    // Determine insurance implications
    const insuranceDecision = calculateInsuranceDecision(dvlaAnalysis);

    // Update Google Sheets with results
    await updateDvlaResults(email, jobId, {
      dvlaData: dvlaAnalysis,
      insuranceDecision: insuranceDecision
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        dvlaData: dvlaAnalysis,
        insuranceDecision: insuranceDecision,
        message: insuranceDecision.approved ? 'DVLA check passed' : 'DVLA check flagged for review'
      })
    };

  } catch (error) {
    console.error('DVLA processing error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'DVLA processing failed',
        details: error.message 
      })
    };
  }
};

// Analyze DVLA document using Claude Vision API
async function analyzeDvlaDocument(dvlaImage, expectedLicenseNumber) {
  try {
    console.log('Analyzing DVLA check with Claude OCR');

    // Check if Claude API is configured
    if (!process.env.CLAUDE_API_KEY) {
      console.log('Claude API not configured, using mock DVLA analysis');
      return getMockDvlaAnalysis();
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
              text: `Please analyze this DVLA driving license check document and extract the following information in JSON format:

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

Expected license number for validation: "${expectedLicenseNumber || 'Not provided'}"`
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: dvlaImage
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

    console.log('DVLA analysis completed:', extractedData);
    
    // Validate extracted data
    validateDvlaData(extractedData, expectedLicenseNumber);
    
    return extractedData;

  } catch (error) {
    console.error('Error analyzing DVLA document:', error);
    return {
      licenseNumber: expectedLicenseNumber || 'unknown',
      isValid: false,
      issues: [`Failed to analyze DVLA document: ${error.message}`],
      confidence: 'low',
      totalPoints: null,
      endorsements: []
    };
  }
}

// Validate extracted DVLA data
function validateDvlaData(data, expectedLicenseNumber) {
  if (!data.licenseNumber || !data.driverName || !data.checkCode) {
    data.issues = data.issues || [];
    data.issues.push('Missing required DVLA check data');
    data.isValid = false;
  }

  if (expectedLicenseNumber && data.licenseNumber !== expectedLicenseNumber) {
    data.issues = data.issues || [];
    data.issues.push('License number mismatch');
  }

  // Validate check code format (should be like "Ab cd ef Gh")
  if (data.checkCode && !/^[A-Za-z]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}$/.test(data.checkCode)) {
    data.issues = data.issues || [];
    data.issues.push('Invalid DVLA check code format');
  }

  return data;
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

  // Check for recent offenses (last 12 months)
  const recentOffenses = endorsements.filter(e => {
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

// Update Google Sheets with DVLA results
async function updateDvlaResults(email, jobId, results) {
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
        action: 'update-dvla-results',
        email: email,
        jobId: jobId,
        dvlaResults: results
      })
    });

    if (response.ok) {
      console.log('DVLA results saved to Google Sheets');
    } else {
      console.error('Failed to save DVLA results');
    }

  } catch (error) {
    console.error('Error saving DVLA results:', error);
  }
}

// Mock DVLA analysis for development
function getMockDvlaAnalysis() {
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
    confidence: "high"
  };
}
