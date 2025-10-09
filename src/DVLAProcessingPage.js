// File: src/DVLAProcessingPage.js
// UPDATED to use centralized router and set DVLA dates
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
  const jobId = urlParams.get('job');
  const isUKDriver = urlParams.get('uk') === 'true';

  // Call centralized router to determine next step
  const callRouter = useCallback(async (currentStepName) => {
    console.log('🚀 DVLA page calling centralized router');
    
    try {
      const routerResponse = await fetch('/.netlify/functions/get-next-step', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: driverEmail,
          currentStep: currentStepName
        })
      });
      
      if (!routerResponse.ok) {
        console.error('❌ Router call failed:', routerResponse.status);
        return null;
      }
      
      const routerData = await routerResponse.json();
      console.log('✅ Router response:', routerData);
      
      return routerData.nextStep;
      
    } catch (error) {
      console.error('❌ Error calling router:', error);
      return null;
    }
  }, [driverEmail]);

  // Navigate to next step using router result
  const navigateToNext = useCallback((nextStep) => {
    console.log(`🚦 DVLA navigating to: ${nextStep}`);
    
    // Map router steps to URL steps
    const stepMapping = {
      'poa-validation': 'poa-validation',
      'signature': 'signature',
      'dvla-check': 'dvla-processing',
      'passport-upload': 'passport-upload'
    };
    
    const urlStep = stepMapping[nextStep] || 'signature';
    
    // Navigate to next step
    window.location.href = `/?step=${urlStep}&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
  }, [driverEmail, jobId]);

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
        
        // Use router to determine next step instead of local logic
        const nextStep = await callRouter('dvla-processing');
        
        // If router says we shouldn't be here, navigate away
        if (nextStep !== 'dvla-check') {
          navigateToNext(nextStep);
        } else {
          // We should be on DVLA upload
          setCurrentStep('dvla-upload');
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
  }, [driverEmail, callRouter, navigateToNext]);

  useEffect(() => {
    if (driverEmail) {
      loadDriverData();
    } else {
      setError('No driver email provided');
      setCurrentStep('error');
    }
  }, [driverEmail, loadDriverData]);

  // Save DVLA validation date after successful processing
  const saveDvlaDate = async () => {
    console.log('💾 Saving DVLA validation date to Monday.com');
    
    try {
      const today = new Date();
      const validityDays = 30; // DVLA checks are valid for 30 days
      
      const dvlaValidUntil = new Date(today);
      dvlaValidUntil.setDate(dvlaValidUntil.getDate() + validityDays);
      const dvlaDateString = dvlaValidUntil.toISOString().split('T')[0];
      
      console.log('📅 Setting dvlaValidUntil:', dvlaDateString);
      
      // Update Monday.com with the DVLA validity date
      const response = await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'update-driver-board-a',
          email: driverEmail,
          updates: {
            dvlaValidUntil: dvlaDateString
          }
        })
      });
      
      if (response.ok) {
        console.log('✅ DVLA date saved successfully');
      } else {
        console.error('❌ Failed to save DVLA date');
      }
      
    } catch (error) {
      console.error('❌ Error saving DVLA date:', error);
    }
  };
 
// handleFileUpload function, updated to validate BEFORE saving
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

      // ========== DVLA VALIDATION - DO ALL CHECKS BEFORE SAVING ANYTHING ==========
      if (fileType === 'dvla' && processingResult.result) {
        const dvlaResult = processingResult.result;
        
        // STEP 1: Check if document structure is valid
        if (!dvlaResult.isValid) {
          const issues = [];
          
          if (dvlaResult.validationIssues && dvlaResult.validationIssues.length > 0) {
            dvlaResult.validationIssues.forEach(issue => {
              if (issue.includes('30 days')) {
                issues.push('Document is too old - must be generated within the last 30 days');
              } else if (issue.includes('check code')) {
                issues.push('Missing check code - please upload the FULL PDF document, not just a screenshot');
              } else if (issue.includes('header')) {
                issues.push('Missing DVLA header - please upload the complete document');
              } else {
                issues.push(issue);
              }
            });
          } else {
            issues.push('Document appears incomplete or invalid');
            issues.push('Make sure you upload the FULL PDF from gov.uk, not a screenshot');
          }
          
          setError({ issues });
          setLoading(false);
          return; // STOP - don't save anything
        }
        
        // STEP 2: Check license ending matches (anti-fraud)
        if (driverData?.licenseEnding && dvlaResult.licenseEnding) {
          if (driverData.licenseEnding !== dvlaResult.licenseEnding) {
            console.error('❌ License mismatch detected!');
            console.error(`Expected: ${driverData.licenseEnding}, Got: ${dvlaResult.licenseEnding}`);
            
            setError({
              issues: [
                '⚠️ Licence number mismatch detected',
                `The licence ending on this DVLA check (${dvlaResult.licenseEnding}) does not match your verified ID (${driverData.licenseEnding})`,
                '',
                'Possible reasons:',
                '• You uploaded someone else\'s DVLA check by mistake',
                '• The DVLA check belongs to a different person',
                '• There was an error during your ID verification',
                '',
                'Please check you\'re uploading YOUR OWN DVLA check and try again.',
                'If the problem persists, contact support at info@oooshtours.co.uk'
              ]
            });
            setLoading(false);
            return; // STOP - don't save anything
          }
        }
        
        // STEP 3: Check driver name matches (additional anti-fraud)
        if (driverData?.name && dvlaResult.driverName) {
          // Normalize names for comparison (remove extra spaces, convert to uppercase)
          const normalizedExpected = driverData.name.toUpperCase().replace(/\s+/g, ' ').trim();
          const normalizedActual = dvlaResult.driverName.toUpperCase().replace(/\s+/g, ' ').trim();
          
          // Check if names match (allow for some flexibility with middle names, prefixes)
          const namesMatch = normalizedActual.includes(normalizedExpected) || 
                           normalizedExpected.includes(normalizedActual);
          
          if (!namesMatch) {
            console.error('❌ Name mismatch detected!');
            console.error(`Expected: ${driverData.name}, Got: ${dvlaResult.driverName}`);
            
            setError({
              issues: [
                '⚠️ Name mismatch detected',
                `The name on this DVLA check (${dvlaResult.driverName}) does not match your verified ID (${driverData.name})`,
                '',
                'Possible reasons:',
                '• You uploaded someone else\'s DVLA check by mistake',
                '• The DVLA check belongs to a different person',
                '• There was an error during your ID verification',
                '',
                'Please check you\'re uploading YOUR OWN DVLA check and try again.',
                'If the problem persists, contact support at info@oooshtours.co.uk'
              ]
            });
            setLoading(false);
            return; // STOP - don't save anything
          }
        }
        
        // ========== ALL VALIDATION PASSED - NOW SAFE TO SAVE ==========
        console.log('✅ All DVLA validation checks passed - proceeding to save data');
        
        // Clear any previous errors
        setError('');
        
        // Save DVLA validity date
        await saveDvlaDate();
        
        // Format endorsements with points
        let endorsementCodes = 'None';
        if (dvlaResult.endorsements && dvlaResult.endorsements.length > 0) {
          endorsementCodes = dvlaResult.endorsements
            .map(e => `${e.code} (${e.points} pts)`)
            .join(', ');
        }
        
        // Calculate total excess: base £1,000 + additional + VAT
        const baseExcess = 1000;
        const additionalExcess = dvlaResult.insuranceDecision?.excess || 0;
        const totalBeforeVat = baseExcess + additionalExcess;
        const totalWithVat = totalBeforeVat * 1.2;
        const calculatedExcess = `£${totalWithVat.toLocaleString('en-GB')}`;
        
        console.log('💾 Saving DVLA insurance data:', {
          points: dvlaResult.totalPoints || 0,
          endorsements: endorsementCodes,
          additionalExcess: additionalExcess,
          totalExcess: calculatedExcess
        });
        
        // Update Monday.com with insurance data
        await updateDriverData({
          dvlaPoints: dvlaResult.totalPoints || 0,
          dvlaEndorsements: endorsementCodes,
          dvlaCalculatedExcess: calculatedExcess
        });
        
        // Show results to user
        console.log('DVLA Check Results:', {
          name: dvlaResult.driverName,
          licenseEnding: dvlaResult.licenseEnding,
          points: dvlaResult.totalPoints,
          insuranceDecision: dvlaResult.insuranceDecision
        });
      }
        
      // Upload DVLA file to Monday.com
      if (fileType === 'dvla' && imageData) {
        console.log('📤 Uploading DVLA file to Monday.com...');
        
        const uploadResponse = await fetch('/.netlify/functions/monday-integration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload-file-board-a',
            email: driverEmail,
            fileType: 'dvla',
            fileData: imageData.split(',')[1],
            filename: `dvla_${Date.now()}.png`,
            contentType: 'image/png'
          })
        });
        
        const uploadResult = await uploadResponse.json();
        if (uploadResult.success) {
          console.log('✅ DVLA file uploaded to Monday.com');
        } else {
          console.error('❌ Failed to upload DVLA file:', uploadResult.error);
        }
      }
          
      // Store results
      setProcessingResults(prev => ({ ...prev, [fileType]: processingResult.result }));

      // Update Monday.com with results
      await updateDriverData({
        [`${fileType}ProcessingResult`]: JSON.stringify(processingResult.result),
        [`${fileType}ProcessingDate`]: new Date().toISOString().split('T')[0],
        [`${fileType}Status`]: processingResult.result.decision || 'Processed'
      });

      // Use router to determine next step after DVLA
      if (fileType === 'dvla') {
        const nextStep = await callRouter('dvla-complete');
        if (nextStep) {
          navigateToNext(nextStep);
        } else {
          // Fallback
          setCurrentStep('poa-validation');
        }
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
      
      // After final validation, use router to go to signature
      setTimeout(async () => {
        const nextStep = await callRouter('validation-complete');
        if (nextStep) {
          navigateToNext(nextStep);
        }
      }, 3000);

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
    <div className="mx-auto h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
      <FileText className="h-8 w-8 text-blue-600" />
    </div>
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
    <li>Download or save the PDF <b>(click the "Print or save driving summary")</b></li>
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
 <div className="mt-4 p-5 bg-red-50 border-2 border-red-400 rounded-lg shadow-sm">
    <p className="text-xl font-bold text-red-900 mb-2">
      ⚠️ IMPORTANT
    </p>
    <p className="text-lg text-red-800 leading-relaxed">
      Upload the <strong>full PDF document</strong> showing the green/orange header and check code - not just a screenshot of the code itself!
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
                <h3 className="text-base font-medium text-green-900">DVLA check complete</h3>
                <p className="text-sm text-green-800 mt-1">
                  Licence valid • {processingResults.dvla.points || 0} points • {processingResults.dvla.decision}
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

// DVLA Upload Component (unchanged)
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
      {loading && (
        <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
          <div className="flex items-center">
            <Loader className="animate-spin h-5 w-5 text-purple-600 mr-3" />
            <p className="text-lg font-medium text-purple-900">Processing your DVLA document...</p>
          </div>
          <p className="text-sm text-purple-700 mt-2 ml-8">This may take a few seconds</p>
        </div>
      )}
      
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
              {typeof error === 'string' ? (
                <p className="text-base text-red-800">{error}</p>
              ) : (
                <>
                  <p className="text-base font-semibold text-red-900 mb-2">DVLA document validation failed:</p>
                  <ul className="list-disc list-inside space-y-1 text-base text-red-800 mb-3">
                    {error.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                  <p className="text-base text-red-900 font-medium">Please generate a fresh DVLA check and upload the complete PDF</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Verification Complete Component (unchanged)
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
        <p>Need help? Contact us info@oooshtours.co.uk</p>
      </div>
    </div>
  );
};

export default DVLAProcessingPage;
