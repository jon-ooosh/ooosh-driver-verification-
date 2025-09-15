// File: src/POAValidationPage.js
// POA duplicate checking and date extraction page

import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Loader, FileText, Calendar } from 'lucide-react';

const POAValidationPage = ({ driverEmail, jobId }) => {
  const [loading, setLoading] = useState(true);
  const [validationResult, setValidationResult] = useState(null);
  const [error, setError] = useState('');
  const [driverData, setDriverData] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    validatePOADocuments();
  }, []);

  const validatePOADocuments = async () => {
    try {
      setLoading(true);
      console.log('🔍 Starting POA validation for:', driverEmail);
      
      // Wait for webhook to have processed and stored POA URLs
      let poaData = null;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        console.log(`⏳ Checking for POA documents (attempt ${attempts + 1}/${maxAttempts})...`);
        
        // Fetch driver status to get POA URLs from Monday
        const statusResponse = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
        
        if (statusResponse.ok) {
          const status = await statusResponse.json();
          console.log('📊 Driver status retrieved:', {
            hasPOA1: !!status.poa1Url,
            hasPOA2: !!status.poa2Url,
            nationality: status.nationality,
            licenseIssuedBy: status.licenseIssuedBy
          });
          
          // Check if we have both POA URLs
          if (status.poa1Url && status.poa2Url) {
            poaData = status;
            setDriverData(status);
            break;
          }
        }
        
        // Wait with exponential backoff
        const delay = Math.min(2000 * Math.pow(1.5, attempts), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempts++;
      }
      
      if (!poaData || !poaData.poa1Url || !poaData.poa2Url) {
        console.log('⚠️ POA documents not available yet');
        setError('POA documents are still being processed. Please wait a moment...');
        setLoading(false);
        
        // Auto-retry after 5 seconds
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
          validatePOADocuments();
        }, 5000);
        return;
      }
      
      console.log('🔬 Validating POA documents for duplicates...');
      
      // Call document-processor to validate POAs
      const validationResponse = await fetch('/.netlify/functions/document-processor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dual-poa',
          imageData: poaData.poa1Url,  // Can be URL or base64
          imageData2: poaData.poa2Url,
          licenseAddress: poaData.licenseAddress || poaData.homeAddress,
          email: driverEmail
        })
      });
      
      if (!validationResponse.ok) {
        throw new Error('POA validation service error');
      }
      
      const result = await validationResponse.json();
      console.log('✅ POA validation complete:', result);
      
      // Extract dates from POA documents
      const poa1Date = result.result?.poa1?.documentDate || null;
      const poa2Date = result.result?.poa2?.documentDate || null;
      
      // Calculate validity dates (90 days from document date, or 30 days from today as fallback)
      const today = new Date();
      const defaultValidityDays = 30;
      const normalValidityDays = 90;
      
      let poa1ValidUntil, poa2ValidUntil;
      
      if (poa1Date) {
        const date1 = new Date(poa1Date);
        date1.setDate(date1.getDate() + normalValidityDays);
        poa1ValidUntil = date1.toISOString().split('T')[0];
      } else {
        const fallbackDate = new Date(today);
        fallbackDate.setDate(fallbackDate.getDate() + defaultValidityDays);
        poa1ValidUntil = fallbackDate.toISOString().split('T')[0];
      }
      
      if (poa2Date) {
        const date2 = new Date(poa2Date);
        date2.setDate(date2.getDate() + normalValidityDays);
        poa2ValidUntil = date2.toISOString().split('T')[0];
      } else {
        const fallbackDate = new Date(today);
        fallbackDate.setDate(fallbackDate.getDate() + defaultValidityDays);
        poa2ValidUntil = fallbackDate.toISOString().split('T')[0];
      }
      
      // Update Monday.com with POA validity dates
      console.log('📅 Updating POA validity dates in Monday.com...');
      await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-driver-board-a',
          email: driverEmail,
          updates: {
           poa1ValidUntil: poa1ValidUntil,  // Maps to date_mktr1keg
      poa2ValidUntil: poa2ValidUntil,  // Maps to date_mktra1a6
      additionalDetails: `POA1: ${poa1Date || 'Date not found'}, POA2: ${poa2Date || 'Date not found'}`,
      overallStatus: result.result?.crossValidation?.approved ? 'POA Validated' : 'POA Review Required'
    }
  })
});
      
      setValidationResult({
        ...result,
        poa1ValidUntil,
        poa2ValidUntil
      });
      
      // Auto-proceed after 3 seconds if validation passed
      if (result.result?.crossValidation?.approved) {
        setTimeout(() => {
          proceedToNext();
        }, 3000);
      }
      
    } catch (err) {
      console.error('❌ POA validation error:', err);
      setError(err.message || 'Failed to validate POA documents');
    } finally {
      setLoading(false);
    }
  };

  const proceedToNext = () => {
    // Check if UK driver based on webhook data
    const isUKDriver = 
      driverData?.nationality === 'GB' || 
      driverData?.nationality === 'UK' ||
      driverData?.nationality === 'United Kingdom' ||
      driverData?.licenseIssuedBy === 'DVLA' ||
      driverData?.licenseIssuedBy?.includes('UK') ||
      driverData?.licenseIssuedBy?.includes('United Kingdom');
    
    console.log('🚦 Routing decision:', { 
      isUKDriver, 
      nationality: driverData?.nationality,
      issuedBy: driverData?.licenseIssuedBy 
    });
    
    if (isUKDriver) {
      // UK driver - go to DVLA check
      window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
    } else {
      // Non-UK driver - verification complete
      window.location.href = `/?step=complete&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
    }
  };

  const retryValidation = () => {
    setError('');
    setValidationResult(null);
    validatePOADocuments();
  };

  // Loading state
  if (loading) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <Loader className="h-12 w-12 text-purple-600 animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Validating Proof of Address
          </h2>
          <p className="text-gray-600">
            Checking your address documents...
          </p>
          <div className="mt-6 space-y-2 text-sm text-gray-500">
            <div className="flex items-center justify-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>Checking for duplicate documents</span>
            </div>
            <div className="flex items-center justify-center space-x-2">
              <Calendar className="h-4 w-4" />
              <span>Extracting document dates</span>
            </div>
          </div>
          {retryCount > 0 && (
            <p className="mt-4 text-sm text-yellow-600">
              Retry attempt {retryCount}...
            </p>
          )}
        </div>
      </div>
    );
  }

  // Skipping validation display (POAs still valid)
  if (skippingValidation) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Address Documents Still Valid
          </h2>
          <p className="text-gray-600 mb-4">
            Your proof of address documents are still valid. No re-validation needed.
          </p>
          <div className="bg-green-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-green-800">
              POA 1 valid until: {driverData?.poa1ValidUntil}
            </p>
            <p className="text-sm text-green-800">
              POA 2 valid until: {driverData?.poa2ValidUntil}
            </p>
          </div>
          <p className="text-sm text-gray-500">
            Proceeding to next step...
          </p>
        </div>
      </div>
    );
  }

  // Error state (temporary - will auto-retry)
  if (error && !validationResult) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Processing Documents
          </h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={retryValidation}
            className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700"
          >
            Check Again
          </button>
          <p className="text-sm text-gray-500 mt-3">
            Will retry automatically in a few seconds...
          </p>
        </div>
      </div>
    );
  }

  // Results display
  const isDuplicate = validationResult?.result?.isDuplicate;
  const isApproved = validationResult?.result?.crossValidation?.approved;
  const validation = validationResult?.result?.crossValidation || {};
  const poa1 = validationResult?.result?.poa1 || {};
  const poa2 = validationResult?.result?.poa2 || {};

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
                  '✗ Same document uploaded twice - please provide two different proof of address documents'
                }
              </p>
            </div>
          </div>

          {/* Document dates */}
          {!isDuplicate && (
            <>
              <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                  <Calendar className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">Document 1</p>
                  <p className="text-sm text-gray-600">
                    {poa1.providerName || 'Unknown Provider'} - 
                    {poa1.documentDate ? ` Dated: ${poa1.documentDate}` : ' Date not found'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Valid until: {validationResult?.poa1ValidUntil}
                  </p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0 mr-3">
                  <Calendar className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">Document 2</p>
                  <p className="text-sm text-gray-600">
                    {poa2.providerName || 'Unknown Provider'} - 
                    {poa2.documentDate ? ` Dated: ${poa2.documentDate}` : ' Date not found'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Valid until: {validationResult?.poa2ValidUntil}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Address display if extracted */}
      {(poa1.address || poa2.address) && !isDuplicate && (
        <div className="bg-blue-50 rounded-lg p-4 mb-6">
          <p className="font-medium text-blue-900 mb-1">Verified Address:</p>
          <p className="text-blue-800">{poa1.address || poa2.address}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col space-y-3">
        {isDuplicate ? (
          <>
            <p className="text-red-600 font-medium mb-2">
              Please go back to Idenfy and upload two different proof of address documents
            </p>
            <button
              onClick={() => window.location.href = `/?step=document-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`}
              className="w-full bg-red-600 text-white py-3 px-4 rounded-md hover:bg-red-700"
            >
              Return to Document Upload
            </button>
          </>
        ) : isApproved ? (
          <>
            <button
              onClick={proceedToNext}
              className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700"
            >
              Continue to {driverData?.nationality === 'GB' ? 'DVLA Check' : 'Complete Verification'}
            </button>
            <p className="text-sm text-gray-500 text-center">
              Proceeding automatically in a moment...
            </p>
          </>
        ) : (
          <>
            <button
              onClick={proceedToNext}
              className="w-full bg-yellow-500 text-white py-3 px-4 rounded-md hover:bg-yellow-600"
            >
              Continue (Manual Review Required)
            </button>
            <p className="text-sm text-orange-600 text-center mt-2">
              Your application will be flagged for manual review
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default POAValidationPage;
