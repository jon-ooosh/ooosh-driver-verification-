// File: src/POAValidationPage.js
// UPDATED with client-side PDF processing for deferred documents

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, XCircle, AlertCircle, Loader, Calendar } from 'lucide-react';

const POAValidationPage = ({ driverEmail, jobId }) => {
  const [loading, setLoading] = useState(true);
  const [processingPDFs, setProcessingPDFs] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [error, setError] = useState('');
  const [driverData, setDriverData] = useState(null);
  
  // Track which documents we've already processed to prevent duplicates
  const processedDocsRef = useRef({
    poa1: false,
    poa2: false
  });

  // Load PDF.js for client-side conversion
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    };
    document.head.appendChild(script);
  }, []);

  // Use centralized router instead of local logic
  const proceedToNext = useCallback(async () => {
    console.log('🚀 POA Validation complete - calling centralized router');
    
    try {
      // Call the centralized router
      const routerResponse = await fetch('/.netlify/functions/get-next-step', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: driverEmail,
          currentStep: 'poa-validation-complete'
        })
      });
      
      if (!routerResponse.ok) {
        console.error('❌ Router call failed:', routerResponse.status);
        // Fallback to DVLA for UK drivers
        window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
        return;
      }
      
      const routerData = await routerResponse.json();
      console.log('✅ Router response:', routerData);
      
      const nextStep = routerData.nextStep;
      const reason = routerData.reason;
      
      console.log(`🚦 POA routing to: ${nextStep} (${reason})`);
      
      // Map router steps to URL steps
      const stepMapping = {
        'dvla-check': 'dvla-processing',
        'passport-upload': 'passport-upload',
        'signature': 'signature',
        'poa-validation': 'poa-validation'  // In case POAs still need work
      };
      
      const urlStep = stepMapping[nextStep] || 'signature';
      
      // Navigate to next step
      window.location.href = `/?step=${urlStep}&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      
    } catch (error) {
      console.error('❌ Error calling router:', error);
      // Fallback based on what we know
      if (driverData?.licenseIssuedBy === 'DVLA') {
        window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      } else {
        window.location.href = `/?step=passport-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      }
    }
  }, [driverEmail, jobId, driverData]);

 // Process a document (PDF or image) client-side
  const processDocument = useCallback(async (url, documentType) => {
    console.log(`📄 Processing document from URL: ${url}`);
    
    try {
      // Fetch the document
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch document');
      
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Check file type from magic bytes
      const isPNG = uint8Array[0] === 0x89 && uint8Array[1] === 0x50 && 
                    uint8Array[2] === 0x4E && uint8Array[3] === 0x47;
      const isJPEG = uint8Array[0] === 0xFF && uint8Array[1] === 0xD8;
      const isPDF = uint8Array[0] === 0x25 && uint8Array[1] === 0x50 && 
                    uint8Array[2] === 0x44 && uint8Array[3] === 0x46;
      
      let imageData;
      
      if (isPNG || isJPEG) {
        // Already an image - convert to base64 directly
        console.log(`✅ Document is already an image (${isPNG ? 'PNG' : 'JPEG'})`);
       // Convert large arrays in chunks to avoid stack overflow
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, chunk);
        }
        imageData = btoa(binary);
        
      } else if (isPDF) {
        // PDF needs conversion using PDF.js
        console.log('📄 Document is PDF, converting to image...');
        
        if (!window.pdfjsLib) {
          throw new Error('PDF.js not loaded yet');
        }
        
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        
        const scale = 2.0;
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
        
        // Convert canvas to base64
        imageData = canvas.toDataURL('image/png').split(',')[1];
        console.log('✅ PDF converted to image');
        
      } else {
        throw new Error('Unknown file type - not PNG, JPEG, or PDF');
      }
      
      // Process with document-processor
      console.log('🔄 Sending to document-processor for OCR...');
      const processingResponse = await fetch('/.netlify/functions/document-processor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'poa',
          imageData: imageData,
          documentType: documentType,
          fileType: 'image'
        })
      });
      
      if (!processingResponse.ok) {
        const errorText = await processingResponse.text();
        console.error('Document processor error:', errorText);
        throw new Error('Document processing failed');
      }
      
      const result = await processingResponse.json();
      
      if (result.success && result.result) {
        console.log('✅ OCR extraction successful:', result.result);
        return result.result;
      } else {
        throw new Error('Invalid processing result');
      }
      
    } catch (error) {
      console.error(`❌ Error processing document ${documentType}:`, error);
      throw error;
    }
  }, []);

  // Function to save POA validation dates after successful processing
  const savePoaDates = useCallback(async (poa1Date, poa2Date) => {
    console.log('💾 Saving POA validation dates to Monday.com');
    
    try {
      // Calculate validity dates
      const today = new Date();
      const defaultValidityDays = 30;
      const documentValidityDays = 90;
      
      // POA1 date calculation
      let poa1ValidUntil;
      if (poa1Date && poa1Date !== 'Not extracted') {
        const docDate = new Date(poa1Date);
        if (!isNaN(docDate.getTime())) {
          // Document date + 90 days
          docDate.setDate(docDate.getDate() + documentValidityDays);
          poa1ValidUntil = docDate.toISOString().split('T')[0];
        }
      }
      if (!poa1ValidUntil) {
        // Default: today + 30 days
        const defaultDate = new Date(today);
        defaultDate.setDate(defaultDate.getDate() + defaultValidityDays);
        poa1ValidUntil = defaultDate.toISOString().split('T')[0];
      }
      
      // POA2 date calculation
      let poa2ValidUntil;
      if (poa2Date && poa2Date !== 'Not extracted') {
        const docDate = new Date(poa2Date);
        if (!isNaN(docDate.getTime())) {
          // Document date + 90 days
          docDate.setDate(docDate.getDate() + documentValidityDays);
          poa2ValidUntil = docDate.toISOString().split('T')[0];
        }
      }
      if (!poa2ValidUntil) {
        // Default: today + 30 days
        const defaultDate = new Date(today);
        defaultDate.setDate(defaultDate.getDate() + defaultValidityDays);
        poa2ValidUntil = defaultDate.toISOString().split('T')[0];
      }
      
      console.log('📅 Calculated POA validity dates:', {
        poa1ValidUntil,
        poa2ValidUntil
      });
      
      // Update Monday.com with the dates
      const response = await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'update-driver-board-a',
          email: driverEmail,
          updates: {
            poa1ValidUntil: poa1ValidUntil,
            poa2ValidUntil: poa2ValidUntil
          }
        })
      });
      
      if (response.ok) {
        console.log('✅ POA dates saved successfully');
      } else {
        console.error('❌ Failed to save POA dates');
      }
      
    } catch (error) {
      console.error('❌ Error saving POA dates:', error);
    }
  }, [driverEmail]);

const checkPoaValidationResults = useCallback(async () => {
    const MAX_ATTEMPTS = 20;
    let alreadyProcessed = false; // Track if we've processed in THIS function call
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(`🔍 Checking for POA URLs: ${driverEmail} (attempt ${attempt}/${MAX_ATTEMPTS})`);
        
        // Fetch driver status with cache buster
        const statusResponse = await fetch(
          `/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}&t=${Date.now()}`
        );
        
        if (!statusResponse.ok) {
          throw new Error('Failed to fetch driver status');
        }
        
        const status = await statusResponse.json();
        setDriverData(status);
        
        console.log('📊 POA URLs from Monday:', {
          poa1URL: status.poa1URL ? 'Present' : 'Missing',
          poa2URL: status.poa2URL ? 'Present' : 'Missing'
        });
        
        // Check if we have the URLs we need (webhook has completed)
        if (status.poa1URL || status.poa2URL) {
          console.log('✅ POA URLs found, checking if already processed...');
          
          // Check both ref (across renders) AND local flag (within this loop)
          if (alreadyProcessed || (processedDocsRef.current.poa1 && processedDocsRef.current.poa2)) {
            console.log('⏭️ Documents already processed - exiting loop completely');
            return; // Exit the entire function
          }
          
          // Mark as being processed NOW to prevent loop re-entry
          alreadyProcessed = true;
          
          setLoading(false);
          setProcessingPDFs(true);
          
          try {
            let poa1Result, poa2Result;
            
            // Process POA1 if URL exists AND not already processed
            if (status.poa1URL && !processedDocsRef.current.poa1) {
              console.log('📄 Processing POA1 from URL...');
              poa1Result = await processDocument(status.poa1URL, 'poa1');
              processedDocsRef.current.poa1 = true; // Mark as processed
              console.log('✅ POA1 processed and marked complete');
            } else if (processedDocsRef.current.poa1) {
              console.log('⏭️ POA1 already processed, skipping');
            }
            
            // Process POA2 if URL exists AND not already processed
            if (status.poa2URL && !processedDocsRef.current.poa2) {
              console.log('📄 Processing POA2 from URL...');
              poa2Result = await processDocument(status.poa2URL, 'poa2');
              processedDocsRef.current.poa2 = true; // Mark as processed
              console.log('✅ POA2 processed and marked complete');
            } else if (processedDocsRef.current.poa2) {
              console.log('⏭️ POA2 already processed, skipping');
            }
            // Check for duplicates
            const isDuplicate = poa1Result?.providerName && poa2Result?.providerName && 
                               poa1Result.providerName === poa2Result.providerName;
            
           // Build validation result
            const validationResult = {
              isDuplicate: isDuplicate,
              approved: !isDuplicate && poa1Result && poa2Result,
              poa1: poa1Result || { providerName: 'Not processed', documentDate: 'Not extracted' },
              poa2: poa2Result || { providerName: 'Not processed', documentDate: 'Not extracted' },
              crossValidation: {
                approved: !isDuplicate && poa1Result && poa2Result,
                issues: isDuplicate ? ['Same document uploaded twice'] : []
              }
            };
            
            setValidationResult(validationResult);
            setProcessingPDFs(false);
            setLoading(false);
            
            // Handle different outcomes
            if (validationResult.approved) {
              console.log('💾 Saving POA dates to Monday.com...');
              await savePoaDates(poa1Result.documentDate, poa2Result.documentDate);
              console.log('✅ POA validation complete, proceeding to next step in 3 seconds');
              setTimeout(() => proceedToNext(), 3000);
            } else if (isDuplicate) {
              console.log('⚠️ Duplicate documents detected - flagging for review');
              
              // Set status to Stuck for manual review
              try {
                await fetch('/.netlify/functions/monday-integration', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'update-driver-board-a',
                    email: driverEmail,
                    updates: {
                      overallStatus: 'Stuck',
                      additionalDetails: 'Duplicate POA documents detected - same source uploaded twice. Requires manual review or re-upload.'
                    }
                  })
                });
                console.log('✅ Status set to Stuck for manual review');
              } catch (error) {
                console.error('❌ Failed to update status:', error);
              }
            }
            
            return; // Exit - processing complete
            
          } catch (error) {
            console.error('❌ Error processing POA documents:', error);
            setProcessingPDFs(false);
            setError('Failed to process documents. Please contact support.');
            setLoading(false);
            return; // Exit on error
          }
        }
        
        // URLs not found yet - wait and retry if we have attempts left
        if (attempt < MAX_ATTEMPTS) {
          console.log(`⏳ URLs not ready yet, waiting 2 seconds... (${attempt}/${MAX_ATTEMPTS})`);
          setLoading(true);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          // Max attempts reached - webhook likely timed out
          console.error('❌ Max attempts reached, POA URLs never arrived from webhook');
          setError('Document processing is taking longer than expected. Please contact support at 01273 911382 or try again.');
          setLoading(false);
          return;
        }
        
      } catch (err) {
        console.error('❌ Error in POA validation check:', err);
        
        if (attempt < MAX_ATTEMPTS) {
          console.log(`⏳ Error occurred, retrying in 2 seconds... (${attempt}/${MAX_ATTEMPTS})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          setError(err.message || 'Failed to check POA validation results');
          setLoading(false);
          return;
        }
      }
    }
  }, [driverEmail, proceedToNext, savePoaDates, processDocument]);

  useEffect(() => {
    checkPoaValidationResults();
  }, [checkPoaValidationResults]);

  // Loading state
  if (loading || processingPDFs) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <Loader className="h-12 w-12 text-purple-600 animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {processingPDFs ? 'Processing Documents' : 'Checking Address Validation'}
          </h2>
          <p className="text-gray-600">
            {processingPDFs 
              ? 'Converting and analyzing your documents...' 
              : 'Retrieving your validation results...'}
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !validationResult) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Error Loading Results
          </h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // No POAs needed (license-only verification)
  if (!validationResult) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            No Address Validation Required
          </h2>
          <p className="text-gray-600 mb-4">
            This verification doesn't require proof of address documents.
          </p>
          <p className="text-sm text-gray-500">
            Proceeding to next step...
          </p>
        </div>
      </div>
    );
  }

  // Results display (unchanged)
  const isDuplicate = validationResult?.isDuplicate;
  const isApproved = validationResult?.crossValidation?.approved;
  const poa1 = validationResult?.poa1 || {};
  const poa2 = validationResult?.poa2 || {};

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md p-8">
      <div className="text-center mb-6">
        {isDuplicate ? (
          <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
        ) : isApproved ? (
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        ) : (
          <AlertCircle className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
        )}
        
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {isDuplicate ? 'Duplicate Documents Detected' : 
           isApproved ? 'Address Documents Validated' : 
           'Manual Review Required'}
        </h2>
      </div>

      <div className="bg-gray-50 rounded-lg p-6 mb-6">
        <h3 className="font-semibold text-lg mb-4">Validation Results</h3>
        
        <div className="space-y-3">
          {/* Duplicate check */}
          <div className="flex items-start">
            <div className="flex-shrink-0 mr-3">
              {!isDuplicate ? 
                <CheckCircle className="h-5 w-5 text-green-500" /> : 
                <XCircle className="h-5 w-5 text-red-500" />
              }
            </div>
            <div>
              <p className="font-medium">Document Uniqueness</p>
              <p className="text-sm text-gray-600">
                {!isDuplicate ? 
                  '✓ Two different documents provided' :
                  '✗ Same document uploaded twice'
                }
              </p>
            </div>
          </div>

          {/* Document details */}
          {!isDuplicate && (
            <>
              <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                  <Calendar className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">Document 1</p>
                  <p className="text-sm text-gray-600">
                    {poa1.providerName} - {poa1.documentDate}
                  </p>
                  {poa1.validUntil && (
                    <p className="text-xs text-gray-500">
                      Valid until: {poa1.validUntil}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                  <Calendar className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">Document 2</p>
                  <p className="text-sm text-gray-600">
                    {poa2.providerName} - {poa2.documentDate}
                  </p>
                  {poa2.validUntil && (
                    <p className="text-xs text-gray-500">
                      Valid until: {poa2.validUntil}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

    {/* Action buttons */}
      <div className="flex flex-col space-y-3">
        {isDuplicate ? (
          <>
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-4">
              <h3 className="text-lg font-bold text-red-900 mb-2">⚠️ Duplicate documents detected</h3>
              <p className="text-red-800 mb-3">
                It looks like you've uploaded the same document twice OR two documents from the same provider. We need two DIFFERENT proof of address documents from DIFFERENT sources.
              </p>
            </div>
            
            <button
              onClick={() => {
                console.log('🔄 Redirecting to Idenfy for POA re-upload');
                window.location.href = `/?step=document-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}&poaOnly=true`;
              }}
              className="w-full bg-red-600 text-white py-3 px-4 rounded-md hover:bg-red-700 font-semibold"
            >
              Upload new documents
            </button>
            
            <button
              onClick={async () => {
                console.log('⚠️ User bypassing duplicate check - flagging for manual review');
                
                // Set status to "Stuck" for manual review
                try {
                  await fetch('/.netlify/functions/monday-integration', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'update-driver-board-a',
                      email: driverEmail,
                      updates: {
                        overallStatus: 'Stuck',
                        additionalDetails: 'Driver claims POA documents are NOT duplicates despite system detection. Manual review required.'
                      }
                    })
                  });
                  
                  console.log('✅ Flagged for manual review, proceeding to next step');
                  proceedToNext();
                  
                } catch (error) {
                  console.error('❌ Failed to flag for review:', error);
                  // Proceed anyway
                  proceedToNext();
                }
              }}
              className="w-full bg-orange-500 text-white py-3 px-4 rounded-md hover:bg-orange-600 text-sm"
            >
              These ARE different documents - proceed with rest of verification and we will manually review.
            </button>
            </>
        ) : isApproved ? (
          <>
            <button
              onClick={() => proceedToNext()}
              className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700"
            >
              Continue to next step
            </button>
            <p className="text-sm text-gray-500 text-center">
              Proceeding automatically...
            </p>
          </>
        ) : (
          <>
            <button
              onClick={() => proceedToNext()}
              className="w-full bg-yellow-500 text-white py-3 px-4 rounded-md hover:bg-yellow-600"
            >
              Continue (Manual Review Required)
            </button>
            <p className="text-sm text-orange-600 text-center mt-2">
              Your documents will be reviewed manually
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default POAValidationPage;
