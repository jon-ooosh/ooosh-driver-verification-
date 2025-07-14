// File: functions/idenfy-webhook.js
// ENHANCED VERSION - Integrates Claude OCR for POA validation
// Processes Idenfy results + runs Claude OCR for insurance compliance

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

    // Process the verification result
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
          claudeValidation: processResult.claudeValidation
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

// ENHANCED: Process verification with Claude OCR integration
async function processEnhancedVerificationResult(email, jobId, scanRef, status, data, fullWebhookData) {
  try {
    console.log('Processing enhanced verification for:', { email, jobId, scanRef });

    // Step 1: Analyze basic Idenfy verification result
    const idenfyResult = analyzeIdenfyVerificationResult(status, data);
    console.log('Idenfy verification analysis:', idenfyResult);

    // Step 2: Extract POA documents for Claude OCR validation
    let claudeValidation = null;
    if (idenfyResult.approved && fullWebhookData.additionalData) {
      console.log('Running Claude OCR validation on POA documents...');
      claudeValidation = await runClaudePoaValidation(
        email, 
        jobId, 
        fullWebhookData.additionalData,
        idenfyResult.licenseAddress
      );
    }

    // Step 3: Combine Idenfy + Claude results for final decision
    const finalResult = combineVerificationResults(idenfyResult, claudeValidation);
    console.log('Final combined verification result:', finalResult);

    // Step 4: Update database with comprehensive results
    const updateResult = await updateEnhancedVerificationInDatabase(
      email,
      jobId,
      scanRef,
      finalResult,
      claudeValidation
    );

    return { 
      success: true, 
      data: finalResult,
      claudeValidation: claudeValidation
    };

  } catch (error) {
    console.error('Error processing enhanced verification result:', error);
    return { success: false, error: error.message };
  }
}

// Analyze Idenfy verification result (existing logic)
function analyzeIdenfyVerificationResult(status, data) {
  const result = {
    overall: status.overall,
    scanRef: data?.scanRef || 'unknown',
    
    // Document analysis
    licenseValid: false,
    licenseExpiry: null,
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
    documentNumber: data?.docNumber || null,
    
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
      
      // Extract license data
      if (data?.docExpiry) result.licenseExpiry = data.docExpiry;
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

// NEW: Run Claude OCR validation on POA documents
async function runClaudePoaValidation(email, jobId, additionalData, licenseAddress) {
  try {
    console.log('Extracting POA documents from Idenfy additional data...');
    
    // Extract POA document images from Idenfy webhook data
    const poaDocuments = extractPoaDocumentsFromIdenfyData(additionalData);
    
    if (poaDocuments.length < 2) {
      console.log('Insufficient POA documents for Claude validation');
      return {
        success: false,
        error: 'Less than 2 POA documents provided',
        poaCount: poaDocuments.length
      };
    }

    // Call our Claude OCR validation function
    const claudeResponse = await fetch(`${process.env.URL}/.netlify/functions/validate-poa-documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        jobId: jobId,
        poaDocuments: poaDocuments,
        licenseAddress: licenseAddress
      })
    });

    if (claudeResponse.ok) {
      const claudeResult = await claudeResponse.json();
      console.log('Claude POA validation completed:', claudeResult);
      return claudeResult;
    } else {
      console.error('Claude POA validation failed:', claudeResponse.status);
      return {
        success: false,
        error: `Claude validation failed: ${claudeResponse.status}`
      };
    }

  } catch (error) {
    console.error('Error running Claude POA validation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Extract POA document images from Idenfy additional data
function extractPoaDocumentsFromIdenfyData(additionalData) {
  const poaDocuments = [];
  
  try {
    // Look for utility bills, bank statements, etc. in Idenfy response
    if (additionalData.utilityBills) {
      additionalData.utilityBills.forEach((doc, index) => {
        if (doc.imageData) {
          poaDocuments.push({
            type: 'utility_bill',
            imageData: doc.imageData,
            documentId: `utility_${index + 1}`
          });
        }
      });
    }
    
    if (additionalData.bankStatements) {
      additionalData.bankStatements.forEach((doc, index) => {
        if (doc.imageData) {
          poaDocuments.push({
            type: 'bank_statement',
            imageData: doc.imageData,
            documentId: `bank_${index + 1}`
          });
        }
      });
    }
    
    // Add other POA document types as needed
    console.log(`Extracted ${poaDocuments.length} POA documents for Claude validation`);
    
  } catch (error) {
    console.error('Error extracting POA documents:', error);
  }
  
  return poaDocuments;
}

// Combine Idenfy + Claude results for final decision
function combineVerificationResults(idenfyResult, claudeValidation) {
  const finalResult = { ...idenfyResult };
  
  // Add Claude validation results
  finalResult.claudeOcrCompleted = !!claudeValidation;
  finalResult.poaValidation = claudeValidation;
  
  // Override approval if Claude validation fails
  if (claudeValidation && !claudeValidation.validation?.approved) {
    finalResult.approved = false;
    finalResult.rejected = true;
    finalResult.rejectionReason = 'POA documents failed compliance validation';
    finalResult.rejectionDetails = claudeValidation.validation?.issues || [];
  }
  
  // Set final status
  if (finalResult.approved && claudeValidation?.validation?.approved) {
    finalResult.finalStatus = 'approved';
  } else if (finalResult.suspected || !claudeValidation?.success) {
    finalResult.finalStatus = 'review_required';
  } else {
    finalResult.finalStatus = 'rejected';
  }
  
  return finalResult;
}

// Update database with enhanced verification results
async function updateEnhancedVerificationInDatabase(email, jobId, scanRef, finalResult, claudeValidation) {
  try {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL) {
      console.log('Google Apps Script URL not configured');
      return { success: false, error: 'No database URL configured' };
    }

    const updatePayload = {
      action: 'update-enhanced-verification-results',
      email: email,
      jobId: jobId,
      scanRef: scanRef,
      idenfyResults: finalResult,
      claudeResults: claudeValidation
    };

    console.log('Sending enhanced update to Google Apps Script');

    const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Enhanced database update successful:', result);
      return { success: true };
    } else {
      const errorText = await response.text();
      console.error('Enhanced database update failed:', response.status, errorText);
      return { success: false, error: `Database update failed: ${response.status}` };
    }

  } catch (error) {
    console.error('Error updating enhanced database:', error);
    return { success: false, error: error.message };
  }
}
