// File: src/POAValidationPage.js
// POA duplicate checking and date extraction page

import React, { useState, useEffect } from 'react';
import { FileText, CheckCircle, XCircle, AlertCircle, Loader, Upload, Calendar, MapPin, Home } from 'lucide-react';

const POAValidationPage = ({ email, jobId, onComplete }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationStatus, setValidationStatus] = useState('checking');
  const [poaDocuments, setPOADocuments] = useState([]);
  const [duplicateDetected, setDuplicateDetected] = useState(false);
  const [validityDates, setValidityDates] = useState({ poa1: null, poa2: null });
  const [nationality, setNationality] = useState(null);
  const [skippingValidation, setSkippingValidation] = useState(false);

  useEffect(() => {
    if (!email || !jobId) {
      console.error('Missing email or jobId');
      // Navigate to home by changing URL
      window.location.href = '/';
      return;
    }
    
    // Start validation process
    validatePOADocuments();
  }, [email, jobId]);

  const validatePOADocuments = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Step 1: Fetch driver data to check existing POA validity
      const driverResponse = await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getDriver',
          email: email
        })
      });

      if (!driverResponse.ok) {
        throw new Error('Failed to fetch driver data');
      }

      const driverData = await driverResponse.json();
      console.log('Driver data:', driverData);
      
      // Extract nationality for routing decision later
      setNationality(driverData.driver?.nationalityGroup);
      
      // Check if POAs are still valid
      const poa1ValidUntil = driverData.driver?.poa1ValidUntil;
      const poa2ValidUntil = driverData.driver?.poa2ValidUntil;
      
      if (poa1ValidUntil && poa2ValidUntil) {
        const now = new Date();
        const poa1Valid = new Date(poa1ValidUntil) > now;
        const poa2Valid = new Date(poa2ValidUntil) > now;
        
        if (poa1Valid && poa2Valid) {
          console.log('POAs still valid, skipping validation');
          setSkippingValidation(true);
          setValidationStatus('valid');
          
          // Wait 5 seconds to ensure webhook has processed
          setTimeout(() => {
            routeToNextStep();
          }, 5000);
          return;
        }
      }
      
      // Step 2: Fetch POA documents from the recent Idenfy session
      const poaResponse = await fetch('/.netlify/functions/get-poa-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          jobId: jobId
        })
      });

      if (!poaResponse.ok) {
        throw new Error('Failed to fetch POA documents');
      }

      const poaData = await poaResponse.json();
      setPOADocuments(poaData.documents || []);
      
      // Step 3: Check for duplicate documents
      if (poaData.documents && poaData.documents.length >= 2) {
        const isDuplicate = await checkForDuplicates(poaData.documents[0], poaData.documents[1]);
        
        if (isDuplicate) {
          setDuplicateDetected(true);
          setValidationStatus('duplicate');
          setError('Same document uploaded twice. Please upload two different proof of address documents.');
          return;
        }
      }
      
      // Step 4: Extract dates and validate diversity
      const validation = await validateDocumentDiversity(poaData.documents);
      
      if (validation.success) {
        // Store validity dates in Monday.com
        await updatePOAValidity(validation.dates);
        setValidityDates(validation.dates);
        setValidationStatus('valid');
        
        // Route to next step after a short delay
        setTimeout(() => {
          routeToNextStep();
        }, 2000);
      } else {
        setValidationStatus('invalid');
        setError(validation.error || 'POA validation failed');
      }
      
    } catch (err) {
      console.error('POA validation error:', err);
      setError(err.message || 'Failed to validate POA documents');
      setValidationStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const checkForDuplicates = async (doc1, doc2) => {
    // Use AWS Textract or similar to compare documents
    try {
      const response = await fetch('/.netlify/functions/compare-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document1: doc1.url,
          document2: doc2.url
        })
      });
      
      const result = await response.json();
      return result.isDuplicate;
    } catch (err) {
      console.error('Error comparing documents:', err);
      return false;
    }
  };

  const validateDocumentDiversity = async (documents) => {
    if (!documents || documents.length < 2) {
      return { success: false, error: 'Two POA documents required' };
    }
    
    try {
      // Extract text and dates from documents using OCR
      const response = await fetch('/.netlify/functions/extract-poa-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: documents.map(d => d.url)
        })
      });
      
      const extractedData = await response.json();
      
      // Check if documents are from different sources
      const sourceDiversity = extractedData.source1 !== extractedData.source2;
      
      if (!sourceDiversity) {
        return { 
          success: false, 
          error: 'Documents must be from different providers (e.g., one bank statement and one utility bill)' 
        };
      }
      
      // Calculate validity dates (90 days from document date, or 30 days fallback)
      const dates = {
        poa1: calculateValidityDate(extractedData.date1),
        poa2: calculateValidityDate(extractedData.date2)
      };
      
      return { success: true, dates };
      
    } catch (err) {
      console.error('Error validating document diversity:', err);
      return { success: false, error: 'Failed to validate documents' };
    }
  };

  const calculateValidityDate = (documentDate) => {
    if (!documentDate) {
      // Fallback: 30 days from today
      const date = new Date();
      date.setDate(date.getDate() + 30);
      return date.toISOString().split('T')[0];
    }
    
    // 90 days from document date
    const date = new Date(documentDate);
    date.setDate(date.getDate() + 90);
    return date.toISOString().split('T')[0];
  };

  const updatePOAValidity = async (dates) => {
    try {
      await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updatePOADates',
          email: email,
          poa1ValidUntil: dates.poa1,
          poa2ValidUntil: dates.poa2
        })
      });
    } catch (err) {
      console.error('Error updating POA validity dates:', err);
    }
  };

  const routeToNextStep = () => {
    // Route based on nationality using URL parameters like the rest of the app
    if (nationality === 'UK') {
      window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(email)}&jobId=${jobId}`;
    } else {
      window.location.href = `/?step=passport-upload&email=${encodeURIComponent(email)}&jobId=${jobId}`;
    }
  };

  const handlePOAReupload = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Trigger Idenfy session for POA-only re-upload
      const response = await fetch('/.netlify/functions/idenfy-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          sessionType: 'poa-reupload',
          additionalSteps: ['PROOF_OF_ADDRESS']
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create re-upload session');
      }
      
      const { authToken, redirectUrl } = await response.json();
      
      // Redirect to Idenfy for POA re-upload
      window.location.href = redirectUrl;
      
    } catch (err) {
      console.error('POA re-upload error:', err);
      setError('Failed to start re-upload process');
      setLoading(false);
    }
  };

  // Render different states
  if (loading || validationStatus === 'checking') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <Loader className="mx-auto h-12 w-12 text-purple-600 animate-spin mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {skippingValidation ? 'Verifying Previous Documents' : 'Validating Address Documents'}
            </h2>
            <p className="text-gray-600">
              {skippingValidation 
                ? 'Your proof of address documents are still valid. Preparing next step...'
                : 'Checking your proof of address documents...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (validationStatus === 'duplicate') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <XCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Duplicate Document Detected</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <AlertCircle className="h-5 w-5 text-yellow-600 inline mr-2" />
              <span className="text-sm text-yellow-800">
                You need two different proof of address documents (e.g., a bank statement AND a utility bill)
              </span>
            </div>
            
            <button
              onClick={handlePOAReupload}
              disabled={loading}
              className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              <Upload className="h-5 w-5" />
              <span>Upload Different Documents</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (validationStatus === 'valid') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Address Verified</h2>
            <p className="text-gray-600 mb-6">
              Your proof of address documents have been validated successfully
            </p>
            
            {validityDates.poa1 && validityDates.poa2 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                <div className="text-sm text-green-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center">
                      <Home className="h-4 w-4 mr-2" />
                      Document 1 valid until:
                    </span>
                    <span className="font-medium">
                      {new Date(validityDates.poa1).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center">
                      <MapPin className="h-4 w-4 mr-2" />
                      Document 2 valid until:
                    </span>
                    <span className="font-medium">
                      {new Date(validityDates.poa2).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            <p className="text-sm text-gray-500">
              Redirecting to {nationality === 'UK' ? 'DVLA verification' : 'passport upload'}...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (validationStatus === 'error' || validationStatus === 'invalid') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <XCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Validation Failed</h2>
            <p className="text-gray-600 mb-6">{error || 'Unable to validate your documents'}</p>
            
            <div className="space-y-3">
              <button
                onClick={validatePOADocuments}
                className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                Try Again
              </button>
              
              <button
                onClick={() => {
                  // Navigate to contact support with state
                  window.location.href = `/?step=contact-support&email=${encodeURIComponent(email)}&issue=poa-validation`;
                }}
                className="w-full bg-gray-200 text-gray-700 py-3 px-4 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                Contact Support
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default POAValidationPage;
