// File: functions/pdf-to-image-processor.js
// Server-side PDF to Image conversion for AWS Textract compatibility
// Uses pdf2pic library to convert PDFs to high-quality images

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('PDF to Image Processor called');
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { imageData, fileType, testMode } = JSON.parse(event.body);
    
    if (!imageData) {
      throw new Error('No document data provided');
    }

    console.log(`Processing ${fileType} document`);
    
    let processedImageData;
    let conversionApplied = false;
    
    // If it's a PDF, convert to image first
    if (fileType === 'pdf') {
      console.log('🔄 Converting PDF to image...');
      processedImageData = await convertPdfToImage(imageData);
      conversionApplied = true;
      console.log('✅ PDF converted to image successfully');
    } else {
      // If it's already an image, use as-is
      processedImageData = imageData;
      conversionApplied = false;
    }
    
    // Now process with AWS Textract (we know images work)
    console.log('📞 Processing with AWS Textract...');
    const textractResult = await processWithTextract(processedImageData);
    
    // Parse DVLA-specific data
    const dvlaData = parseDvlaFromText(textractResult.extractedText);
    
    // Calculate insurance decision
    dvlaData.insuranceDecision = calculateInsuranceDecision(dvlaData);
    
    // Add processing metadata
    dvlaData.processingInfo = {
      originalFormat: fileType,
      processedFormat: conversionApplied ? 'image' : fileType,
      conversionApplied: conversionApplied,
      conversionMethod: conversionApplied ? 'pdf2pic' : 'none',
      confidence: textractResult.confidence,
      extractionSuccess: true
    };
    
    console.log('✅ Document processing completed successfully');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        result: dvlaData,
        processingMethod: 'PDF→Image→AWS Textract',
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('PDF processing error:', error);
    
    // Check if it's a dependency issue
    if (error.message.includes('pdf2pic') || error.message.includes('poppler')) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'PDF conversion dependencies not installed',
          details: error.message,
          instructions: 'Need to install pdf2pic and poppler-utils dependencies',
          fallbackSuggestion: 'For now, please save the DVLA document as an image (screenshot) instead of PDF'
        })
      };
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'PDF processing failed',
        details: error.message,
        suggestion: 'Try downloading the DVLA check as an image instead'
      })
    };
  }
};

// Convert PDF to high-quality image using pdf2pic
async function convertPdfToImage(pdfBase64) {
  console.log('🔄 Starting PDF to image conversion...');
  
  try {
    // Option 1: Try using pdf2pic (requires npm install pdf2pic)
    const pdf2pic = require("pdf2pic");
    const fs = require('fs').promises;
    const path = require('path');
    
    // Create temporary files
    const tempDir = '/tmp';
    const pdfPath = path.join(tempDir, `temp-${Date.now()}.pdf`);
    const outputPath = tempDir;
    
    // Save PDF to temporary file
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    await fs.writeFile(pdfPath, pdfBuffer);
    
    console.log('📄 PDF saved to temporary file');
    
    // Configure conversion - high quality for OCR
    const convert = pdf2pic.fromPath(pdfPath, {
      density: 300,           // High DPI for clear text
      saveFilename: `converted-${Date.now()}`,
      savePath: outputPath,
      format: "jpg",
      width: 2480,           // A4 at 300 DPI
      height: 3508,
      quality: 100           // Maximum quality
    });
    
    // Convert first page (DVLA checks are usually single page)
    console.log('🖼️ Converting PDF page to image...');
    const results = await convert(1, false);
    
    if (!results || !results[1] || !results[1].path) {
      throw new Error('PDF conversion failed - no output generated');
    }
    
    // Read the converted image
    const imagePath = results[1].path;
    const imageBuffer = await fs.readFile(imagePath);
    const imageBase64 = imageBuffer.toString('base64');
    
    console.log(`✅ Converted to image: ${Math.round(imageBuffer.length / 1024)}KB`);
    
    // Clean up temporary files
    try {
      await fs.unlink(pdfPath);
      await fs.unlink(imagePath);
      console.log('🧹 Temporary files cleaned up');
    } catch (cleanupError) {
      console.warn('⚠️ Could not clean up temporary files:', cleanupError.message);
    }
    
    return imageBase64;
    
  } catch (error) {
    console.error('PDF conversion error:', error);
    
    // Provide helpful error messages based on the error type
    if (error.code === 'MODULE_NOT_FOUND') {
      throw new Error(`
        PDF conversion library not installed. To fix this:
        
        1. Add to package.json: "pdf2pic": "^2.1.4"
        2. Install system dependencies in Netlify:
           - Add to netlify.toml: 
             [build.environment]
             NPM_FLAGS = "--production=false"
           - Or use a build plugin for poppler-utils
        
        Alternative: Ask users to save DVLA document as image instead of PDF
      `);
    } else if (error.message.includes('poppler') || error.message.includes('pdftocairo')) {
      throw new Error(`
        System dependencies missing. PDF conversion requires poppler-utils.
        
        For Netlify deployment, you need:
        1. A build plugin or Docker container with poppler-utils
        2. Or use a different PDF processing approach
        
        Quick fix: Guide users to save as image instead
      `);
    } else {
      throw new Error(`PDF conversion failed: ${error.message}`);
    }
  }
}

// Process image with AWS Textract (we know this works)
async function processWithTextract(imageBase64) {
  console.log('📞 Processing image with AWS Textract...');
  
  const region = process.env.OOOSH_AWS_REGION || 'eu-west-2';
  const endpoint = `https://textract.${region}.amazonaws.com/`;
  
  // Clean base64
  const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
  
  // Use DetectDocumentText (simpler, works well with converted images)
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
    throw new Error(`Textract processing failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const extractedText = extractTextFromResponse(result);
  
  if (!extractedText || extractedText.length < 50) {
    throw new Error('Textract extracted insufficient text from the converted image');
  }
  
  console.log(`📝 Extracted ${extractedText.length} characters from image`);
  
  return {
    extractedText: extractedText,
    confidence: calculateConfidence(result)
  };
}

// Parse DVLA data from extracted text (your existing logic)
function parseDvlaFromText(text) {
  console.log('🔍 Parsing DVLA data from extracted text...');
  
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
    confidence: 'high'
  };

  // Extract license number (16-character UK format)
  const licenseMatch = text.match(/([A-Z]{2,5}[0-9]{6}[A-Z0-9]{2}[A-Z]{2})/);
  if (licenseMatch) {
    dvlaData.licenseNumber = licenseMatch[1];
    console.log('✅ Found license number:', dvlaData.licenseNumber);
  }

  // Extract driver name (look for common patterns)
  const namePatterns = [
    /Name[:\s]+([A-Z][A-Z\s]+[A-Z])/,
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
  const checkCodeMatch = text.match(/([A-Za-z]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2}\s+[A-Za-z0-9]{2})/);
  if (checkCodeMatch) {
    dvlaData.checkCode = checkCodeMatch[1];
    console.log('✅ Found check code:', dvlaData.checkCode);
  }

  // Extract dates
  const dateMatches = text.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/g);
  if (dateMatches && dateMatches.length > 0) {
    dvlaData.dateGenerated = standardizeDate(dateMatches[0]);
    if (dateMatches.length > 1) {
      dvlaData.validTo = standardizeDate(dateMatches[dateMatches.length - 1]);
    }
  }

  // Extract total points
  const pointsMatch = text.match(/(?:total|penalty)?\s*points?[:\s]*(\d+)/i);
  if (pointsMatch) {
    dvlaData.totalPoints = parseInt(pointsMatch[1]);
    console.log('✅ Found total points:', dvlaData.totalPoints);
  }

  // Extract endorsement codes
  const endorsementMatches = [...text.matchAll(/([A-Z]{2}[0-9]{2})/g)];
  endorsementMatches.forEach(match => {
    const code = match[1];
    if (['SP', 'MS', 'CU', 'IN', 'DR', 'BA', 'DD', 'UT', 'TT'].some(prefix => code.startsWith(prefix))) {
      dvlaData.endorsements.push({
        code: code,
        date: dvlaData.dateGenerated || new Date().toISOString().split('T')[0],
        points: getPointsForEndorsement(code),
        description: getEndorsementDescription(code)
      });
    }
  });

  // Validation
  if (!dvlaData.licenseNumber) {
    dvlaData.issues.push('❌ License number not found');
    dvlaData.isValid = false;
    dvlaData.confidence = 'low';
  }
  
  if (!dvlaData.driverName) {
    dvlaData.issues.push('⚠️ Driver name not found');
    dvlaData.confidence = 'medium';
  }
  
  if (!dvlaData.checkCode) {
    dvlaData.issues.push('⚠️ DVLA check code not found');
  }

  console.log(`🚗 DVLA parsing complete: ${dvlaData.issues.length} issues found`);
  return dvlaData;
}

// Insurance decision logic (your existing function)
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

  // Serious offenses check
  const seriousOffenses = ['MS90', 'IN10', 'DR10', 'DR20', 'DR30'];
  const hasSeriousOffense = endorsements.some(e => seriousOffenses.includes(e.code));

  if (hasSeriousOffense) {
    decision.manualReview = true;
    decision.reasons.push('Serious driving offense - requires manual review');
    return decision;
  }

  // Points-based decisions
  if (points === 0) {
    decision.approved = true;
    decision.riskLevel = 'low';
    decision.reasons.push('Clean license - no points');
  } else if (points <= 3) {
    decision.approved = true;
    decision.riskLevel = 'standard';
    decision.reasons.push('Minor points - standard approval');
  } else if (points <= 6) {
    decision.approved = true;
    decision.riskLevel = 'medium';
    decision.reasons.push('Medium points - approved');
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
function standardizeDate(dateStr) {
  try {
    const date = new Date(dateStr.replace(/[\/\.]/g, '-'));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    console.warn('Could not parse date:', dateStr);
  }
  return dateStr;
}

function getPointsForEndorsement(code) {
  const pointsMap = { 'SP30': 3, 'SP50': 3, 'MS90': 6, 'CU80': 3, 'IN10': 6 };
  return pointsMap[code] || 3;
}

function getEndorsementDescription(code) {
  const descriptions = {
    'SP30': 'Exceeding statutory speed limit on a public road',
    'MS90': 'Failure to give information as to identity of driver',
    'CU80': 'Breach of requirements as to control of vehicle',
    'IN10': 'Using a vehicle uninsured against third party risks'
  };
  return descriptions[code] || 'Traffic offence';
}

function extractTextFromResponse(response) {
  if (!response.Blocks) return '';
  
  return response.Blocks
    .filter(block => block.BlockType === 'LINE')
    .map(block => block.Text)
    .join('\n');
}

function calculateConfidence(response) {
  if (!response.Blocks) return 0;
  
  const confidences = response.Blocks
    .filter(block => block.Confidence)
    .map(block => block.Confidence);
    
  return confidences.length > 0 ? 
    Math.round(confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length) : 0;
}

// AWS signature creation (reuse existing)
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
