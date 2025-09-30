// File: src/POAValidationPage.js
// UPDATED with client-side PDF processing for deferred documents

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Loader, Calendar } from 'lucide-react';

const POAValidationPage = ({ driverEmail, jobId }) => {
  const [loading, setLoading] = useState(true);
  const [processingPDFs, setProcessingPDFs] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [error, setError] = useState('');
  const [driverData, setDriverData] = useState(null);

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

  // Process a PDF document client-side
  const processPDFDocument = useCallback(async (url, documentType) => {
    console.log(`📄 Processing PDF from URL: ${url}`);
    
    try {
      // Fetch the PDF
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch PDF');
      
      const arrayBuffer = await response.arrayBuffer();
      
      // Convert PDF to image using PDF.js
      if (!window.pdfjsLib) {
        throw new Error('PDF.js not loaded yet');
      }
      
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      
      const scale = 2.0; // High quality
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
      const imageData = canvas.toDataURL('image/png').split(',')[1];
      
      console.log('✅ PDF converted to image');
      
      // Process with document-processor
      const processingResponse = await fetch('/.netlify/functions/document-processor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'poa',
          imageData: imageData,
          documentType: documentType
        })
      });
      
      if (!processingResponse.ok) {
        throw new Error('Document processing failed');
      }
      
      const result = await processingResponse.json();
      
      if (result.success && result.result) {
        return result.result;
      } else {
        throw new Error('Invalid processing result');
      }
      
    } catch (error) {
      console.error(`Error processing PDF ${documentType}:`, error);
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
    const MAX_ATTEMPTS = 20; // 40 seconds total (20 attempts × 2 seconds)
    let attempts = 0;
    
    const pollForResults = async () => {
      attempts++;
      
      try {
        setLoading(true);
        console.log(`🔍 Checking POA validation results for: ${driverEmail} (attempt ${attempts}/${MAX_ATTEMPTS})`);
      
      // Fetch driver status
      const statusResponse = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
      
      if (!statusResponse.ok) {
        throw new Error('Failed to fetch driver status');
      }
      
      const status = await statusResponse.json();
      setDriverData(status);
      
      console.log('📊 POA status from Monday:', {
        poa1ValidUntil: status.poa1ValidUntil,
        poa2ValidUntil: status.poa2ValidUntil,
        poa1URL: status.poa1URL,
        poa2URL: status.poa2URL
      });
      
      // NEW: Check if POAs need client-side processing
      const needsPoa1Processing = !status.poa1ValidUntil && status.poa1URL;
      const needsPoa2Processing = !status.poa2ValidUntil && status.poa2URL;
      
      if (needsPoa1Processing || needsPoa2Processing) {
        console.log('🔄 POAs need client-side processing');
        setProcessingPDFs(true);
        
        try {
          let poa1Result, poa2Result;
          
          // Process POA1 if needed
          if (needsPoa1Processing) {
            console.log('Processing POA1 PDF...');
            poa1Result = await processPDFDocument(status.poa1URL, 'poa1');
          } else if (status.poa1ValidUntil) {
            // Already processed
            poa1Result = {
              providerName: status.poa1Provider || 'Unknown',
              documentDate: status.poa1Date || 'Not extracted'
            };
          }
          
          // Process POA2 if needed
          if (needsPoa2Processing) {
            console.log('Processing POA2 PDF...');
            poa2Result = await processPDFDocument(status.poa2URL, 'poa2');
          } else if (status.poa2ValidUntil) {
            // Already processed
            poa2Result = {
              providerName: status.poa2Provider || 'Unknown',
              documentDate: status.poa2Date || 'Not extracted'
            };
          }
          
          // Check for duplicates
          const isDuplicate = poa1Result?.providerName === poa2Result?.providerName;
          
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
          
          // Save dates if validation successful
          if (validationResult.approved) {
            await savePoaDates(
              poa1Result.documentDate,
              poa2Result.documentDate
            );
            
            // Auto-proceed after 3 seconds
            setTimeout(() => proceedToNext(), 3000);
          }
          
        } catch (error) {
          console.error('Error processing PDFs:', error);
          setError('Failed to process documents. Please try again.');
        } finally {
          setProcessingPDFs(false);
        }
        
      } else {
        // POAs already processed or not needed
        console.log('POAs already processed or not part of this verification');
        
        // Build validation result from existing data
        const validationResult = {
          isDuplicate: false,
          approved: status.poa1ValidUntil && status.poa2ValidUntil,
          poa1: {
            providerName: status.poa1Provider || 'Unknown',
            documentDate: status.poa1Date || 'Not extracted',
            validUntil: status.poa1ValidUntil
          },
          poa2: {
            providerName: status.poa2Provider || 'Unknown',
            documentDate: status.poa2Date || 'Not extracted',
            validUntil: status.poa2ValidUntil
          },
          crossValidation: {
            approved: status.poa1ValidUntil && status.poa2ValidUntil,
            issues: []
          }
        };
        
        setValidationResult(validationResult);
        
        if (validationResult.approved) {
          setTimeout(() => proceedToNext(), 3000);
        }
      }
      
   } catch (err) {
          console.error('❌ Error checking POA validation:', err);
          
          // Retry if webhook might still be processing
          if (attempts < MAX_ATTEMPTS && err.message.includes('not found')) {
            console.log(`⏳ Retrying in 2 seconds... (${attempts}/${MAX_ATTEMPTS})`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return pollForResults();
          }
          
          // Max attempts reached - show error with contact option
          setError(
            attempts >= MAX_ATTEMPTS 
              ? 'Validation is taking longer than expected. Please contact support or try again.'
              : err.message || 'Failed to check POA validation results'
          );
        } finally {
          setLoading(false);
        }
      };
      
      // Start polling
      await pollForResults();
      
    }, [driverEmail, proceedToNext, savePoaDates, processPDFDocument]);

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
            <p className="text-red-600 font-medium mb-2">
              Please upload two different proof of address documents
            </p>
            <button
              onClick={() => window.location.href = `/?step=document-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}&type=additional`}
              className="w-full bg-red-600 text-white py-3 px-4 rounded-md hover:bg-red-700"
            >
              Upload Different Documents
            </button>
          </>
        ) : isApproved ? (
          <>
            <button
              onClick={() => proceedToNext()}
              className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700"
            >
              Continue to Next Step
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
