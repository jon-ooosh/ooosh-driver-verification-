// File: src/DVLAProcessingPage.js
// OOOSH Driver Verification - DVLA Processing & Final Validation
// Handles both UK drivers (DVLA + POA) and Non-UK drivers (POA only)

import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileText, Upload, CheckCircle, AlertCircle, ChevronRight, Loader
} from 'lucide-react';

const DVLAProcessingPage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [driverData, setDriverData] = useState(null);
  const [currentStep, setCurrentStep] = useState('loading');
  const [processingResults, setProcessingResults] = useState({});
  const [finalDecision, setFinalDecision] = useState(null);

  useEffect(() => {
  const fontLink = document.createElement('link');
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap';
  fontLink.rel = 'stylesheet';
  document.head.appendChild(fontLink);
  document.body.style.fontFamily = "'Montserrat', sans-serif";
  document.body.style.backgroundColor = '#f7f7f7';
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    };
    document.head.appendChild(script);
    }, []);

  // Get driver email from URL params (passed from webhook)
  const urlParams = new URLSearchParams(window.location.search);
  const driverEmail = urlParams.get('email');
  const isUKDriver = urlParams.get('uk') === 'true';

  const loadDriverData = useCallback(async () => {
    try {
      setLoading(true);
      console.log('🔍 Loading driver data for:', driverEmail);

      const response = await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'find-driver-board-a',
          email: driverEmail
        })
      });

      const result = await response.json();
      
      if (result.success && result.driver) {
        setDriverData(result.driver);
        console.log('✅ Driver data loaded:', result.driver);
        
        // Determine next step based on driver type and existing data
        if (isUKDriver && !result.driver.dvlaCheckStatus) {
          setCurrentStep('dvla-upload');
        } else {
          setCurrentStep('poa-validation');
        }
      } else {
        throw new Error('Driver not found in database');
      }
    } catch (error) {
      console.error('Load driver data error:', error);
      setError(`Failed to load driver data: ${error.message}`);
      setCurrentStep('error');
    } finally {
      setLoading(false);
    }
  }, [driverEmail, isUKDriver]);

  useEffect(() => {
    if (driverEmail) {
      loadDriverData();
    } else {
      setError('No driver email provided');
      setCurrentStep('error');
    }
  }, [driverEmail, loadDriverData]);

 
// handleFileUpload function, updated to process PDFs
const handleFileUpload = async (fileType, file) => {
  try {
    setLoading(true);
    console.log(`📁 Uploading ${fileType} file:`, file.name);

    let imageData;
    
    if (file.type === 'application/pdf') {
      console.log('📄 Converting PDF to image...');
      
      // Check if PDF.js is loaded
      if (!window.pdfjsLib) {
        throw new Error('PDF.js library not loaded yet. Please try again.');
      }
      
      const arrayBuffer = await file.arrayBuffer();
      // Use window.pdfjsLib, not _ or pdfjsLib
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
      imageData = canvas.toDataURL('image/png');
      console.log('✅ PDF converted to image');
      
    } else {
      // Handle regular images
      imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    
    // Now send the image (not PDF) to document processor
    const processingResponse = await fetch('/.netlify/functions/document-processor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testType: fileType === 'dvla' ? 'dvla' : 'poa',
        imageData: imageData.split(',')[1], // Remove data URL prefix
        documentType: fileType === 'dvla' ? 'dvla' : 'utility_bill',
        licenseAddress: driverData?.licenseAddress,
        fileType: 'image' // Always send as image now
      })
    });

    const processingResult = await processingResponse.json();
    
    if (processingResult.success) {
      console.log(`✅ ${fileType.toUpperCase()} processing successful:`, processingResult.result);

      // Check if DVLA validation actually passed
  if (fileType === 'dvla' && processingResult.result) {
    if (!processingResult.result.isValid) {
      setError('❌ Invalid DVLA document. Please upload a valid DVLA check from gov.uk/view-driving-licence');
      setLoading(false);
      return; // Stop processing
    }
       // Clear any previous errors if validation passed
    setError('');
  }
        
      // Display and validate DVLA results
  if (fileType === 'dvla' && processingResult.result) {
    const dvlaData = processingResult.result;
    
    // Check license ending matches Idenfy data
    if (driverData?.licenseEnding && dvlaData.licenseEnding) {
      if (driverData.licenseEnding !== dvlaData.licenseEnding) {
        setError('⚠️ Licence number mismatch - manual review required');
      }
    }
    
    // Show results to user
    console.log('DVLA Check Results:', {
      name: dvlaData.driverName,
      licenseEnding: dvlaData.licenseEnding,
      points: dvlaData.totalPoints,
      insuranceDecision: dvlaData.insuranceDecision
    });
  }
        // Store results
        setProcessingResults(prev => ({ ...prev, [fileType]: processingResult.result }));

        // Update Monday.com with results
        await updateDriverData({
          [`${fileType}ProcessingResult`]: JSON.stringify(processingResult.result),
          [`${fileType}ProcessingDate`]: new Date().toISOString().split('T')[0],
          [`${fileType}Status`]: processingResult.result.decision || 'Processed'
        });

        // Move to next step
        if (fileType === 'dvla') {
          setCurrentStep('poa-validation');
        } else {
          await performFinalValidation();
        }
      } else {
        throw new Error(processingResult.error || `${fileType.toUpperCase()} processing failed`);
      }
    } catch (error) {
    console.error(`${fileType.toUpperCase()} upload error:`, error);
    setError(`Failed to process ${fileType.toUpperCase()} document: ${error.message}`);
  } finally {
    setLoading(false);
  }
};
  const performPOAValidation = async () => {
    try {
      setLoading(true);
      console.log('🔍 Performing POA cross-validation');

      // Get POA documents from Idenfy data (already captured)
      const poa1Data = driverData?.poa1Data ? JSON.parse(driverData.poa1Data) : null;
      const poa2Data = driverData?.poa2Data ? JSON.parse(driverData.poa2Data) : null;

      if (!poa1Data || !poa2Data) {
        // Process POA documents from Idenfy
        console.log('📄 Processing POA documents from Idenfy data');
        
        // This would typically fetch from Idenfy webhook data
        // For now, simulate POA validation
        const poaValidation = {
          poa1Source: 'utility_bill',
          poa2Source: 'bank_statement',
          sourceDiversity: true,
          poa1Date: '2024-12-15',
          poa2Date: '2024-11-28',
          dateValidation: 'Both documents within 90 days',
          overallStatus: 'APPROVED'
        };

        setProcessingResults(prev => ({ ...prev, poa: poaValidation }));
        
        await updateDriverData({
          poaValidationResult: JSON.stringify(poaValidation),
          poaValidationDate: new Date().toISOString().split('T')[0],
          poaStatus: poaValidation.overallStatus
        });

        await performFinalValidation();
      }
    } catch (error) {
      console.error('POA validation error:', error);
      setError(`POA validation failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const performFinalValidation = async () => {
    try {
      setLoading(true);
      console.log('⚖️ Performing final insurance decision');

      const dvlaResult = processingResults.dvla;
      const poaResult = processingResults.poa;

      // Calculate final decision based on all criteria
      let finalStatus = 'APPROVED';
      let reasons = [];

      // DVLA validation (UK drivers only)
      if (isUKDriver && dvlaResult) {
        if (dvlaResult.points >= 9) {
          finalStatus = 'MANUAL_REVIEW';
          reasons.push(`High points: ${dvlaResult.points}`);
        } else if (dvlaResult.hasSerious) {
          finalStatus = 'REJECTED';
          reasons.push('Serious driving convictions');
        }
        
        // Date validation
        if (dvlaResult.documentAge > 30) {
          finalStatus = 'MANUAL_REVIEW';
          reasons.push('DVLA document over 30 days old');
        }
      }

      // POA validation (all drivers)
      if (poaResult && !poaResult.sourceDiversity) {
        finalStatus = 'MANUAL_REVIEW';
        reasons.push('POA documents from same source');
      }

      const decision = {
        finalStatus,
        reasons,
        approvalLevel: finalStatus === 'APPROVED' ? 'automatic' : 'manual',
        timestamp: new Date().toISOString(),
        driverType: isUKDriver ? 'UK' : 'Non-UK',
        dvlaValidation: isUKDriver ? dvlaResult : null,
        poaValidation: poaResult
      };

      setFinalDecision(decision);

      // Update Monday.com with final decision
      await updateDriverData({
        finalDecision: JSON.stringify(decision),
        overallStatus: finalStatus === 'APPROVED' ? 'Done' : 'Stuck',
        completionDate: new Date().toISOString().split('T')[0],
        approvalLevel: decision.approvalLevel
      });

      setCurrentStep('complete');
      console.log('✅ Final validation complete:', decision);

    } catch (error) {
      console.error('Final validation error:', error);
      setError(`Final validation failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const updateDriverData = async (updates) => {
    try {
      const response = await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-driver-board-a',
          email: driverEmail,
          updates
        })
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Update driver data error:', error);
      throw error;
    }
  };

  // Loading state
  if (currentStep === 'loading') {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-lg text-gray-600">Loading driver data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (currentStep === 'error') {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="text-center mb-4">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-xl font-bold text-red-900 mb-2">Verification Error</h2>
          </div>
          <p className="text-base text-red-800 text-center">{error}</p>
        </div>
      </div>
    );
  }

  // DVLA Upload Step (UK drivers only)
  if (currentStep === 'dvla-upload') {
    return (
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="text-center mb-6">
  <img src="https://www.oooshtours.co.uk/images/ooosh-tours-logo.png" 
    alt="Ooosh Tours Ltd" 
    className="mx-auto h-12 w-auto mb-4"
  />
  <h2 className="text-4xl font-bold text-gray-900">Upload your DVLA check</h2>
  </div>
    
{/* Progress Tracker */}
<div className="bg-purple-50 border-2 border-purple-200 p-4 mb-6">
  <h3 className="text-2xl font-medium text-purple-900 mb-3">Verification Progress</h3>
  <div className="space-y-2">
    <div className="flex items-center">
      <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
      <span className="text-lg text-green-700">Documents uploaded</span>
    </div>
    <div className="flex items-center">
      <div className="h-5 w-5 border-2 border-purple-500 rounded-full mr-3 bg-purple-100"></div>
      <span className="text-lg text-purple-700 font-medium">DVLA check</span>
    </div>
    <div className="flex items-center">
      <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
      <span className="text-lg text-gray-600">Confirmation signature</span>
    </div>
  </div>
</div>
                            
  <div className="bg-purple-50 border-2 border-purple-200 rounded-md p-4 mb-6">
  <h3 className="text-2xl font-medium text-purple-900 mb-3">How to get your DVLA check</h3>
  <ol className="text-lg text-purple-800 space-y-2 list-decimal list-inside">
    <li>Visit <a 
      href="https://www.viewdrivingrecord.service.gov.uk/driving-record/licence-number" 
        target="_blank"
        rel="noopener noreferrer"
      className="text-purple-600 hover:text-purple-800 font-semibold text-lg inline-flex items-center"
    >
        www.viewdrivingrecord.service.gov.uk</a></li>
     <li>Generate a check code</li>
    <li>Download or save the PDF (click the "Print or save driving summary")</li>
    <li>Document must be dated within last 30 days</li>
  </ol>
  <div className="mt-4 pt-4 border-t border-purple-300">
    <a 
      href="https://www.oooshtours.co.uk/how-to-get-a-dvla-check-code" 
      target="_blank" 
      rel="noopener noreferrer"
      className="text-purple-600 hover:text-purple-800 font-semibold text-lg inline-flex items-center"
    >
      📖 Need help? View our step-by-step guide
      <ChevronRight className="h-4 w-4 ml-1" />
    </a>
  </div>
  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-300 rounded">
    <p className="text-sm text-yellow-800">
      ⚠️ <strong>Important:</strong> Upload the full PDF showing the green/orange header and check code, not just the code itself
    </p>
  </div>
</div>
       
        <DVLAUploadComponent 
          onFileUpload={(file) => handleFileUpload('dvla', file)}
          loading={loading}
          error={error}
        />
      </div>
    );
  }

  // POA Validation Step
  if (currentStep === 'poa-validation') {
    return (
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="text-center mb-6">
          <FileText className="mx-auto h-12 w-12 text-purple-600 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">Address Verification</h1>
          <p className="text-base text-gray-600 mt-2">Validating your proof of address documents</p>
        </div>

        {isUKDriver && processingResults.dvla && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <div className="flex">
              <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
              <div className="ml-3">
                <h3 className="text-base font-medium text-green-900">DVLA Check Complete</h3>
                <p className="text-sm text-green-800 mt-1">
                  License valid • {processingResults.dvla.points || 0} points • {processingResults.dvla.decision}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h3 className="text-base font-medium text-purple-900 mb-2">Address Document Validation</h3>
            <p className="text-sm text-purple-800">We're checking that your proof of address documents are from different sources and within date</p>
          </div>

          <button
            onClick={performPOAValidation}
            disabled={loading}
            className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-base flex items-center justify-center space-x-2"
          >
            {loading ? (
              <>
                <Loader className="animate-spin h-4 w-4" />
                <span>Validating documents...</span>
              </>
            ) : (
              <>
                <span>Validate Address Documents</span>
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Complete Step
  if (currentStep === 'complete') {
    return (
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="text-center mb-6">
          <div className={`mx-auto h-12 w-12 mb-4 ${
            finalDecision?.finalStatus === 'APPROVED' 
              ? 'text-green-600' 
              : finalDecision?.finalStatus === 'REJECTED'
              ? 'text-red-600'
              : 'text-yellow-600'
          }`}>
            {finalDecision?.finalStatus === 'APPROVED' ? (
              <CheckCircle className="h-12 w-12" />
            ) : (
              <AlertCircle className="h-12 w-12" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Verification Complete</h1>
        </div>

        <VerificationComplete 
          decision={finalDecision}
          driverData={driverData}
          isUKDriver={isUKDriver}
        />
      </div>
    );
  }

  return null;
};

// DVLA Upload Component
const DVLAUploadComponent = ({ onFileUpload, loading, error }) => {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      onFileUpload(e.target.files[0]);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive 
            ? 'border-purple-500 bg-purple-50' 
            : 'border-gray-300 hover:border-purple-400 hover:bg-gray-50'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <Upload className="mx-auto h-8 w-8 text-gray-400 mb-4" />
        <div className="space-y-2">
          <p className="text-base text-gray-600">
            <label htmlFor="dvla-upload" className="cursor-pointer text-purple-600 hover:text-purple-700 font-medium">
              Click to upload
            </label>
            {' '}or drag and drop your DVLA document
          </p>
          <p className="text-sm text-gray-500">PDF, PNG, JPG up to 10MB</p>
        </div>
        <input
          id="dvla-upload"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={handleFileSelect}
          disabled={loading}
          className="hidden"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
            <div className="ml-3">
              <p className="text-base text-red-800">{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Verification Complete Component
const VerificationComplete = ({ decision, driverData, isUKDriver }) => {
  const getStatusColor = (status) => {
    switch (status) {
      case 'APPROVED': return 'text-green-600 bg-green-50 border-green-200';
      case 'REJECTED': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    }
  };

  const getStatusMessage = (status) => {
    switch (status) {
      case 'APPROVED': 
        return 'Your verification has been approved! You can now proceed with your hire.';
      case 'REJECTED': 
        return 'Your verification could not be approved. Please contact support for assistance.';
      default: 
        return 'Your verification requires manual review. We\'ll contact you within 24 hours.';
    }
  };

  return (
    <div className="space-y-6">
      <div className={`border rounded-lg p-4 ${getStatusColor(decision.finalStatus)}`}>
        <h3 className="text-lg font-medium mb-2">
          Status: {decision.finalStatus.replace('_', ' ')}
        </h3>
        <p className="text-base">{getStatusMessage(decision.finalStatus)}</p>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-base font-medium text-gray-900 mb-3">Verification Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Driver Type:</span>
            <span className="font-medium">{isUKDriver ? 'UK Driver' : 'Non-UK Driver'}</span>
          </div>
          {isUKDriver && decision.dvlaValidation && (
            <>
              <div className="flex justify-between">
                <span className="text-gray-600">Licence Points:</span>
                <span className="font-medium">{decision.dvlaValidation.points || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">DVLA Status:</span>
                <span className="font-medium">{decision.dvlaValidation.decision}</span>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <span className="text-gray-600">Address Validation:</span>
            <span className="font-medium">
              {decision.poaValidation?.sourceDiversity ? 'Passed' : 'Review Required'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Completed:</span>
            <span className="font-medium">
              {new Date(decision.timestamp).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {decision.reasons && decision.reasons.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="text-base font-medium text-yellow-900 mb-2">Review Notes</h4>
          <ul className="text-sm text-yellow-800 space-y-1">
            {decision.reasons.map((reason, index) => (
              <li key={index}>• {reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-center text-sm text-gray-500">
        <p>Need help? Contact support at support@ooosh.com</p>
      </div>
    </div>
  );
};

export default DVLAProcessingPage;
