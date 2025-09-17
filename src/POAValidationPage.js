// File: src/POAValidationPage.js
// Simplified POA validation results display page

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Loader, FileText, Calendar } from 'lucide-react';

const POAValidationPage = ({ driverEmail, jobId }) => {
  const [loading, setLoading] = useState(true);
  const [validationResult, setValidationResult] = useState(null);
  const [error, setError] = useState('');
  const [driverData, setDriverData] = useState(null);

  const proceedToNext = useCallback((data) => {
    const checkData = data || driverData;
    
    // Check if UK driver based on stored data
    const isUKDriver = 
      checkData?.nationality === 'GB' || 
      checkData?.nationality === 'UK' ||
      checkData?.nationality === 'United Kingdom' ||
      checkData?.licenseIssuedBy === 'DVLA';
    
    console.log('🚦 Routing decision:', { 
      isUKDriver, 
      nationality: checkData?.nationality,
      issuedBy: checkData?.licenseIssuedBy 
    });
    
    if (isUKDriver) {
      // UK driver - go to DVLA check
      window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
    } else {
      // Non-UK driver - go to passport upload
      window.location.href = `/?step=passport-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
    }
  }, [driverData, driverEmail, jobId]);

  const checkPoaValidationResults = useCallback(async () => {
    try {
      setLoading(true);
      console.log('🔍 Checking POA validation results for:', driverEmail);
      
      // Fetch driver status - this now contains the validation RESULTS, not URLs
      const statusResponse = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
      
      if (!statusResponse.ok) {
        throw new Error('Failed to fetch driver status');
      }
      
      const status = await statusResponse.json();
      setDriverData(status);
      
      console.log('📊 POA validation results from Monday:', {
        poaValidationStatus: status.poaValidationStatus,
        poasProcessed: status.poasProcessed,
        poaDuplicate: status.poaDuplicate,
        poaCrossValidated: status.poaCrossValidated
      });
      
      // Check if POAs were even part of this verification
      if (!status.poasProcessed || status.poasProcessed === 'No') {
        // No POAs in this verification (e.g., license-only renewal)
        console.log('ℹ️ No POAs in this verification - skipping to next step');
        setLoading(false);
        // Auto-proceed after 2 seconds
        setTimeout(() => proceedToNext(status), 2000);
        return;
      }
      
      // Check if POAs are still being processed (webhook might still be running)
      if (status.poasProcessed === 'Processing') {
        console.log('⏳ POAs still being processed by webhook...');
        // Retry in 3 seconds
        setTimeout(() => checkPoaValidationResults(), 3000);
        return;
      }
      
      // Parse the validation results that webhook already calculated
      const validationResult = {
        isDuplicate: status.poaDuplicate === 'Yes',
        approved: status.poaCrossValidated === 'Yes',
        status: status.poaValidationStatus || 'Unknown',
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
          approved: status.poaCrossValidated === 'Yes',
          issues: []
        }
      };
      
      // Build issues list for display
      if (validationResult.isDuplicate) {
        validationResult.crossValidation.issues.push('Same document uploaded twice');
      }
      if (!validationResult.approved && !validationResult.isDuplicate) {
        validationResult.crossValidation.issues.push('Manual review required');
      }
      
      setValidationResult(validationResult);
      
      // Auto-proceed after 3 seconds if validation passed
      if (validationResult.approved) {
        setTimeout(() => proceedToNext(status), 3000);
      }
      
    } catch (err) {
      console.error('❌ Error checking POA validation:', err);
      setError(err.message || 'Failed to check POA validation results');
    } finally {
      setLoading(false);
    }
  }, [driverEmail, proceedToNext]);

  useEffect(() => {
    checkPoaValidationResults();
  }, [checkPoaValidationResults]);

  // Loading state
  if (loading) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <Loader className="h-12 w-12 text-purple-600 animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Checking Address Validation
          </h2>
          <p className="text-gray-600">
            Retrieving your validation results...
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

  // Results display
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
                  <p className="text-xs text-gray-500">
                    Valid until: {poa1.validUntil}
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
                    {poa2.providerName} - {poa2.documentDate}
                  </p>
                  <p className="text-xs text-gray-500">
                    Valid until: {poa2.validUntil}
                  </p>
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
              Continue to {driverData?.nationality === 'GB' ? 'DVLA Check' : 'Next Step'}
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
