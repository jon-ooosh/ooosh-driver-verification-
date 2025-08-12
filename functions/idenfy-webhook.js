// File: functions/idenfy-webhook.js
// ENHANCED VERSION - Integrates AWS Textract OCR + Monday.com storage
// Processes Idenfy results + runs AWS Textract for insurance compliance

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  console.log('Enhanced Idenfy webhook called with method:', event.httpMethod);
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Idenfy-Signature',
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
    if (!event.body) {
      console.log('No body received in webhook');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    console.log('Webhook body:', event.body);
    const webhookData = JSON.parse(event.body);
    console.log('Parsed webhook data:', JSON.stringify(webhookData, null, 2));

    const { clientId, scanRef, status, data, platform, final } = webhookData;

    if (!clientId || !scanRef || !status) {
      console.log('Missing required webhook data');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required webhook data' })
      };
    }

    // Only process final results
    if (!final) {
      console.log('Ignoring non-final webhook result');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Non-final result ignored' })
      };
    }

    console.log('Processing final Idenfy result:', {
      clientId,
      scanRef,
      overall: status.overall,
      autoDocument: status.autoDocument,
      autoFace: status.autoFace
    });

    // Extract client info from clientId
    const clientInfo = parseClientId(clientId);
    if (!clientInfo) {
      console.log('Could not parse client ID:', clientId);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid client ID format' })
      };
    }

    // Process the verification result with AWS Textract + Monday.com integration
    const processResult = await processEnhancedVerificationResult(
      clientInfo.email,
      clientInfo.jobId,
      scanRef,
      status,
      data,
      webhookData
    );

    if (processResult.success) {
      console.log('Enhanced verification result processed successfully');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          message: 'Webhook processed successfully',
          scanRef: scanRef,
          textractProcessing: processResult.textractResults,
          mondayUpdated: processResult.mondayUpdated
        })
      };
    } else {
      console.error('Failed to process verification result:', processResult.error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to process verification result',
          details: processResult.error
        })
      };
    }

  } catch (error) {
    console.error('Webhook processing error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};

// Parse the client ID to extract email and job ID
function parseClientId(clientId) {
  try {
    // Format: ooosh_{jobId}_{email}_{timestamp}
    const parts = clientId.split('_');
    if (parts.length >= 4 && parts[0] === 'ooosh') {
      const jobId = parts[1];
      const emailParts = parts.slice(2, -1);
      const email = emailParts.join('_').replace('_at_', '@').replace('_dot_', '.');
      
      return { email, jobId };
    }
    return null;
  } catch (error) {
    console.error('Error parsing client ID:', error);
    return null;
  }
}

// ENHANCED: Process verification with AWS Textract + Monday.com integration
async function processEnhancedVerificationResult(email, jobId, scanRef, status, data, fullWebhookData) {
  try {
    console.log('Processing enhanced verification for:', { email, jobId, scanRef });

    // Step 1: Analyze basic Idenfy verification result
    const idenfyResult = analyzeIdenfyVerificationResult(status, data);
    console.log('Idenfy verification analysis:', idenfyResult);

    // Step 2: Extract document images for Monday.com storage
    let documentImages = null;
    if (idenfyResult.approved && fullWebhookData.fileUrls) {
      console.log('Extracting document images from Idenfy webhook...');
      documentImages = extractDocumentImages(fullWebhookData.fileUrls);
    }

    // Step 3: Process documents with AWS Textract if verification succeeded
    let textractResults = null;
    if (idenfyResult.approved && idenfyResult.licenseValid) {
      console.log('Running AWS Textract processing on verified documents...');
      textractResults = await runTextractProcessing(email, jobId, data, idenfyResult);
    } else {
      console.log('Skipping AWS Textract - Idenfy verification failed');
      textractResults = { skipped: 'Idenfy verification failed' };
    }

    // Step 4: Combine Idenfy + AWS Textract results for final decision
    const finalResult = combineVerificationResults(idenfyResult, textractResults);
    console.log('Final combined verification result:', finalResult);

    // Step 5: Update Monday.com with comprehensive results
    const mondayUpdated = await updateMondayWithResults(
      email,
      jobId,
      scanRef,
      finalResult,
      textractResults,
      documentImages
    );

    return { 
      success: true, 
      data: finalResult,
      textractResults: textractResults,
      mondayUpdated: mondayUpdated,
      documentImages: documentImages
    };

  } catch (error) {
    console.error('Error processing enhanced verification result:', error);
    return { success: false, error: error.message };
  }
}

// Analyze Idenfy verification result 
function analyzeIdenfyVerificationResult(status, data) {
  const result = {
    overall: status.overall,
    scanRef: data?.scanRef || 'unknown',
    
    // Document analysis
    licenseValid: false,
    licenseExpiry: null,
    licenseNumber: null,
    licenseAddress: null,
    
    // Face verification
    faceValid: false,
    
    // Overall status
    approved: false,
    suspected: false,
    denied: false,
    
    // Additional data
    documentType: data?.docType || null,
    firstName: data?.docFirstName || null,
    lastName: data?.docLastName || null,
    dateOfBirth: data?.docDob || null,
    
    // Verification details
    autoDocument: status.autoDocument,
    autoFace: status.autoFace,
    manualDocument: status.manualDocument,
    manualFace: status.manualFace,
    
    // Issues
    mismatchTags: status.mismatchTags || [],
    fraudTags: status.fraudTags || [],
    suspicionReasons: status.suspicionReasons || []
  };

  // Determine overall approval status
  switch (status.overall) {
    case 'APPROVED':
      result.approved = true;
      result.licenseValid = (status.autoDocument === 'DOC_VALIDATED' || status.manualDocument === 'DOC_VALIDATED');
      result.faceValid = (status.autoFace === 'FACE_MATCH' || status.manualFace === 'FACE_MATCH');
      
      // Extract license data from Idenfy
      if (data?.docExpiry) result.licenseExpiry = data.docExpiry;
      if (data?.docNumber) result.licenseNumber = data.docNumber;
      if (data?.docAddress) result.licenseAddress = data.docAddress;
      break;
      
    case 'SUSPECTED':
      result.suspected = true;
      result.licenseValid = (status.autoDocument === 'DOC_VALIDATED');
      result.faceValid = (status.autoFace === 'FACE_MATCH');
      break;
      
    case 'DENIED':
      result.denied = true;
      result.licenseValid = false;
      result.faceValid = false;
      break;
      
    default:
      console.log('Unknown verification status:', status.overall);
      result.denied = true;
  }

  return result;
}

// Extract document images from Idenfy webhook
function extractDocumentImages(fileUrls) {
  try {
    console.log('Extracting document images from Idenfy fileUrls');
    
    const images = {
      licenseFront: null,
      licenseBack: null,
      passport: null,
      poa1: null,
      poa2: null,
      selfie: null
    };

    // Map Idenfy file types to our structure
    if (fileUrls.FRONT) images.licenseFront = fileUrls.FRONT;
    if (fileUrls.BACK) images.licenseBack = fileUrls.BACK;
    if (fileUrls.FACE) images.selfie = fileUrls.FACE;
    if (fileUrls.PASSPORT) images.passport = fileUrls.PASSPORT;
    
    // POA documents (if included in Idenfy flow)
    if (fileUrls.UTILITY) images.poa1 = fileUrls.UTILITY;
    if (fileUrls.BANK_STATEMENT) images.poa2 = fileUrls.BANK_STATEMENT;

    console.log('Extracted document images:', Object.keys(images).filter(key => images[key]));
    return images;

  } catch (error) {
    console.error('Error extracting document images:', error);
    return null;
  }
}

// Run AWS Textract processing on verified documents
async function runTextractProcessing(email, jobId, idenfyData, idenfyResult) {
  try {
    console.log('Starting AWS Textract processing for DVLA check...');
    
    // Check if we have UK license that needs DVLA validation
    if (!idenfyResult.licenseNumber || !idenfyResult.licenseNumber.match(/^[A-Z]{2,5}[0-9]{6}/)) {
      console.log('Non-UK license or no license number - skipping DVLA processing');
      return {
        skipped: 'Non-UK license or no license number detected',
        licenseNumber: idenfyResult.licenseNumber
      };
    }

    console.log('UK license detected, DVLA processing will be needed separately');
    
    // Note: DVLA check is a separate document uploaded by user
    // This webhook processes Idenfy results, DVLA check comes later
    return {
      message: 'UK license detected - DVLA check will be processed when user uploads it',
      licenseNumber: idenfyResult.licenseNumber,
      licenseAddress: idenfyResult.licenseAddress,
      requiresDvlaCheck: true
    };

  } catch (error) {
    console.error('Error in AWS Textract processing:', error);
    return {
      error: error.message,
      processingFailed: true
    };
  }
}

// Combine Idenfy + AWS Textract results for final decision
function combineVerificationResults(idenfyResult, textractResults) {
  const finalResult = { ...idenfyResult };
  
  // Add AWS Textract results
  finalResult.textractProcessed = !!textractResults;
  finalResult.textractResults = textractResults;
  
  // Determine final status based on combined results
  if (idenfyResult.approved && idenfyResult.licenseValid && idenfyResult.faceValid) {
    if (textractResults?.requiresDvlaCheck) {
      finalResult.finalStatus = 'documents_verified_dvla_pending';
      finalResult.nextStep = 'Upload DVLA check document';
    } else if (textractResults?.skipped) {
      finalResult.finalStatus = 'documents_verified_complete';
      finalResult.nextStep = 'Complete insurance questionnaire';
    } else {
      finalResult.finalStatus = 'documents_verified_processing';
      finalResult.nextStep = 'Processing additional documents';
    }
  } else if (idenfyResult.suspected) {
    finalResult.finalStatus = 'review_required';
    finalResult.nextStep = 'Manual review required';
  } else {
    finalResult.finalStatus = 'verification_failed';
    finalResult.nextStep = 'Document verification failed';
  }
  
  return finalResult;
}

// Update Monday.com with comprehensive verification results
async function updateMondayWithResults(email, jobId, scanRef, finalResult, textractResults, documentImages) {
  try {
    console.log('Updating Monday.com with verification results');

    // Prepare Monday.com update data
    const mondayData = {
      // Basic info from Idenfy
      name: finalResult.firstName && finalResult.lastName ? 
            `${finalResult.firstName} ${finalResult.lastName}` : null,
      licenseNumber: finalResult.licenseNumber,
      licenseExpiryDate: finalResult.licenseExpiry,
      licenseAddress: finalResult.licenseAddress,
      dateOfBirth: finalResult.dateOfBirth,
      
      // Verification status
      status: mapToMondayStatus(finalResult.finalStatus),
      
      // Document validity
      licenseValid: finalResult.licenseValid,
      faceVerified: finalResult.faceValid,
      
      // Processing metadata
      idenfySessionId: scanRef,
      idenfyStatus: finalResult.overall,
      lastUpdated: new Date().toISOString(),
      
      // Document images
      documentImages: documentImages
    };

    // Call Monday.com integration to save Idenfy results
    const response = await fetch(`${process.env.URL}/.netlify/functions/monday-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'save-idenfy-results',
        email: email,
        jobId: jobId,
        mondayData: mondayData
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Monday.com updated successfully:', result.success);
      return { success: true, itemId: result.itemId };
    } else {
      console.error('Failed to update Monday.com:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }

  } catch (error) {
    console.error('Error updating Monday.com:', error);
    return { success: false, error: error.message };
  }
}

// Map verification status to Monday.com status labels
function mapToMondayStatus(finalStatus) {
  const statusMap = {
    'documents_verified_complete': 'Done',
    'documents_verified_dvla_pending': 'Working on it',
    'documents_verified_processing': 'Working on it',
    'review_required': 'Working on it',
    'verification_failed': 'Stuck'
  };
  
  return statusMap[finalStatus] || 'Working on it';
}
