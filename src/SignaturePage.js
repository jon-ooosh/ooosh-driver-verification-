// File: src/SignaturePage.js
// Final signature confirmation page for driver verification

import React, { useState, useEffect, useRef } from 'react';
import { 
  CheckCircle, AlertCircle, Loader, RefreshCw, 
  FileText, User, Shield, Mail, Check, X
} from 'lucide-react';

const SignaturePage = ({ driverEmail: propEmail, jobId: propJobId }) => {
  // Support both props and URL params for testing
  const urlParams = new URLSearchParams(window.location.search);
  const driverEmail = propEmail || urlParams.get('email');
  const jobId = propJobId || urlParams.get('job');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [driverData, setDriverData] = useState(null);
  const [jobDetails, setJobDetails] = useState(null);
  const [signature, setSignature] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const minDrawingLength = useRef(0);

  // Add Montserrat font
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    document.body.style.fontFamily = "'Montserrat', sans-serif";
    
    return () => {
      document.body.style.fontFamily = '';
    };
  }, []);

  // Load driver and job data
  useEffect(() => {
    const loadData = async () => {
      if (!driverEmail) {
        setError('No email provided. Please use ?email=driver@email.com in the URL');
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        
        // Get driver data from Board A
        const driverResponse = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
        if (driverResponse.ok) {
          const driver = await driverResponse.json();
          setDriverData(driver);
          console.log('Driver data loaded:', driver);
        } else {
          throw new Error('Failed to load driver data');
        }
        
        // Get job details if job ID provided
        if (jobId) {
          const jobResponse = await fetch(`/.netlify/functions/validate-job?jobId=${jobId}`);
          if (jobResponse.ok) {
            const jobData = await jobResponse.json();
            setJobDetails(jobData.job);
            console.log('Job details loaded:', jobData.job);
          } else {
            console.warn('Could not load job details');
          }
        }
        
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load verification details. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [driverEmail, jobId]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  // Handle drawing
  const startDrawing = (e) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    
    const x = e.type.includes('mouse') ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = e.type.includes('mouse') ? e.clientY - rect.top : e.touches[0].clientY - rect.top;
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    minDrawingLength.current = 0;
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    
    const x = e.type.includes('mouse') ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = e.type.includes('mouse') ? e.clientY - rect.top : e.touches[0].clientY - rect.top;
    
    ctx.lineTo(x, y);
    ctx.stroke();
    minDrawingLength.current += 2; // Track drawing length
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      // Only capture if minimum drawing achieved (prevents accidental dots)
      if (minDrawingLength.current > 50) {
        const canvas = canvasRef.current;
        setSignature(canvas.toDataURL('image/png'));
      }
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignature(null);
    setHasDrawn(false);
    minDrawingLength.current = 0;
  };

  const saveSignatureAndComplete = async () => {
    if (!signature) {
      setError('Please provide your signature');
      return;
    }
    
    setSaving(true);
    setError('');
    
    try {
      // Step 1: Save signature image to Monday Board A
      const signatureData = signature.split(',')[1]; // Remove data:image/png;base64, prefix
      const signatureDate = new Date().toISOString().split('T')[0];
      
      const saveResponse = await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload-file-board-a',
          email: driverEmail,
          fileType: 'signature',
          fileData: signatureData,
          filename: `signature_${Date.now()}.png`,
          contentType: 'image/png'
        })
      });
      
      if (!saveResponse.ok) {
        throw new Error('Failed to save signature');
      }
      
      // Step 2: Update signature date and status in Board A
      await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-driver-board-a',
          email: driverEmail,
          updates: {
            signatureDate: signatureDate,
            overallStatus: 'Verified',
            completionTimestamp: new Date().toISOString()
          }
        })
      });
      
      // Step 3: Copy driver from Board A to Board B if job ID exists
      if (jobId) {
        console.log('Copying driver to Board B with job:', jobId);
        const copyResponse = await fetch('/.netlify/functions/monday-integration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'copy-a-to-b',
            email: driverEmail,
            jobId: jobId
          })
        });
        
        if (!copyResponse.ok) {
          console.warn('Warning: Could not copy to Board B, but verification is complete');
        }
      }
      
      // Step 4: Send confirmation email
      await sendConfirmationEmail(signatureDate);
      
      setCompleted(true);
      
    } catch (err) {
      console.error('Error saving signature:', err);
      setError('Failed to save signature. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const sendConfirmationEmail = async (signatureDate) => {
    try {
      const summary = generateSummary();
      
      await fetch('/.netlify/functions/send-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: driverEmail,
          jobId: jobId,
          summary: summary,
          driverName: driverData?.name || driverData?.driverName || 'Driver',
          jobDetails: jobDetails,
          signatureDate: signatureDate
        })
      });
      
    } catch (err) {
      console.error('Error sending confirmation email:', err);
      // Don't fail the whole process if email fails
    }
  };

  const generateSummary = () => {
    if (!driverData) return {};
    
    return {
      name: driverData.name || driverData.driverName || 'Not provided',
      email: driverEmail,
      phone: `${driverData.phoneCountry || ''} ${driverData.phoneNumber || ''}`,
      nationality: driverData.nationality || 'Not provided',
      dateOfBirth: driverData.dateOfBirth || 'Not provided',
      licenseNumber: driverData.licenseNumber || 'Not provided',
      licenseIssuedBy: driverData.licenseIssuedBy || 'Not provided',
      licenseValidTo: driverData.documents?.license?.expiryDate || driverData.licenseValidTo || 'Not provided',
      datePassedTest: driverData.datePassedTest || driverData.insuranceData?.datePassedTest || 'Not provided',
      homeAddress: driverData.homeAddress || 'Not provided',
      licenseAddress: driverData.licenseAddress || 'Not provided',
      insuranceQuestions: {
        hasDisability: driverData.hasDisability || driverData.insuranceData?.hasDisability || false,
        hasConvictions: driverData.hasConvictions || driverData.insuranceData?.hasConvictions || false,
        hasProsecution: driverData.hasProsecution || driverData.insuranceData?.hasProsecution || false,
        hasAccidents: driverData.hasAccidents || driverData.insuranceData?.hasAccidents || false,
        hasInsuranceIssues: driverData.hasInsuranceIssues || driverData.insuranceData?.hasInsuranceIssues || false,
        hasDrivingBan: driverData.hasDrivingBan || driverData.insuranceData?.hasDrivingBan || false,
        additionalDetails: driverData.additionalDetails || driverData.insuranceData?.additionalDetails || ''
      },
      documents: {
        license: driverData.documents?.license?.valid || false,
        poa1: driverData.documents?.poa1?.valid || false,
        poa2: driverData.documents?.poa2?.valid || false,
        dvlaCheck: driverData.documents?.dvlaCheck?.valid || false,
        passport: driverData.documents?.passport?.valid || false
      }
    };
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Not set';
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  const formatYesNo = (value) => {
    if (value === true || value === 'yes' || value === 'Yes') return 'Yes';
    if (value === false || value === 'no' || value === 'No') return 'No';
    return 'Not answered';
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
          <div className="text-center py-8">
            <Loader className="h-8 w-8 text-purple-600 animate-spin mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900">Loading verification summary...</h2>
          </div>
        </div>
      </div>
    );
  }

  // Error state (no email)
  if (!driverEmail && !loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
          <div className="text-center py-8">
            <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Required</h2>
            <p className="text-gray-600">
              Please access this page with an email parameter:<br/>
              <code className="bg-gray-100 px-2 py-1 rounded">?email=driver@email.com</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Completed state
  if (completed) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
          <div className="text-center py-8">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Verification Complete!</h2>
            <p className="text-xl text-gray-600 mb-6">
              All done! We'll be in touch if there are any issues with your verification.
            </p>
            
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <Mail className="h-6 w-6 text-green-600 mx-auto mb-2" />
              <p className="text-green-800">
                A confirmation email has been sent to <strong>{driverEmail}</strong>
              </p>
            </div>
            
            {jobDetails && (
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <p className="text-gray-700">
                  You're approved for hire <strong>{jobDetails.jobNumber}</strong><br />
                  Starting: <strong>{formatDate(jobDetails.startDate)}</strong>
                </p>
              </div>
            )}
            
            <button
              onClick={() => window.close()}
              className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors"
            >
              Close Window
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main signature form
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-lg p-6" ref={containerRef}>
        {/* Header */}
        <div className="text-center mb-6 border-b pb-4">
          <Shield className="h-12 w-12 text-purple-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-gray-900">Summary and declaration</h1>
          <p className="text-gray-600 mt-2">Please review your information and sign to confirm</p>
        </div>

        {driverData && (
          <>
            {/* Your details*/}
            <div className="mb-6 bg-gray-50 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <User className="h-5 w-5 text-purple-600 mr-2" />
                <h3 className="text-lg font-semibold">Your details</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-600">Name:</span>
                  <span className="ml-2 font-medium">{driverData.name || driverData.driverName || 'Not provided'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Email:</span>
                  <span className="ml-2 font-medium">{driverEmail}</span>
                </div>
                <div>
                  <span className="text-gray-600">Phone:</span>
                  <span className="ml-2 font-medium">
                    {driverData.phoneCountry || ''} {driverData.phoneNumber || 'Not provided'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Nationality:</span>
                  <span className="ml-2 font-medium">{driverData.nationality || 'Not provided'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Date of Birth:</span>
                  <span className="ml-2 font-medium">{formatDate(driverData.dateOfBirth)}</span>
                </div>
                <div>
                  <span className="text-gray-600">Licence Number:</span>
                  <span className="ml-2 font-medium">{driverData.licenseNumber || 'Not provided'}</span>
                </div>
                <div className="md:col-span-2">
                  <span className="text-gray-600">Home Address:</span>
                  <span className="ml-2 font-medium">{driverData.homeAddress || 'Not provided'}</span>
                </div>
                <div className="md:col-span-2">
                  <span className="text-gray-600">Licence Address:</span>
                  <span className="ml-2 font-medium">{driverData.licenseAddress || 'Not provided'}</span>
                </div>
              </div>
            </div>

            {/* Insurance Questions */}
<div className="mb-6 bg-gray-50 rounded-lg p-4">
  <div className="flex items-center mb-3">
    <Shield className="h-5 w-5 text-purple-600 mr-2" />
    <h3 className="text-lg font-semibold">Insurance declarations</h3>
  </div>
  <div className="space-y-2 text-sm">
    <div className="flex justify-between">
      <span>Date Passed Test:</span>
      <span className="font-medium">{formatDate(driverData.datePassedTest || driverData.insuranceData?.datePassedTest)}</span>
    </div>
    
    {/* DVLA Check Results - UK drivers only */}
    {driverData.licenseIssuedBy === 'DVLA' && (driverData.dvlaPoints !== undefined || driverData.dvlaEndorsements || driverData.dvlaCalculatedExcess) && (
      <div className="mt-3 pt-3 border-t border-gray-300">
        <div className="flex justify-between">
          <span>Licence Points:</span>
          <span className="font-medium">
            {driverData.dvlaPoints === 0 ? 'Clean licence' : `${driverData.dvlaPoints} points`}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Endorsements:</span>
          <span className="font-medium">{driverData.dvlaEndorsements || 'None'}</span>
        </div>
        <div className="flex justify-between">
          <span>Insurance Excess:</span>
          <span className="font-medium">{driverData.dvlaCalculatedExcess || '£1,200'}</span>
        </div>
      </div>
    )}
    
    <div className="mt-3 pt-3 border-t border-gray-300">
      <div className="flex justify-between">
        <span>Any disability/medical conditions affecting driving?</span>
        <span className={`font-medium ${formatYesNo(driverData.hasDisability || driverData.insuranceData?.hasDisability) === 'Yes' ? 'text-orange-600' : 'text-green-600'}`}>
          {formatYesNo(driverData.hasDisability || driverData.insuranceData?.hasDisability)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Any motoring convictions?</span>
        <span className={`font-medium ${formatYesNo(driverData.hasConvictions || driverData.insuranceData?.hasConvictions) === 'Yes' ? 'text-orange-600' : 'text-green-600'}`}>
          {formatYesNo(driverData.hasConvictions || driverData.insuranceData?.hasConvictions)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Any pending prosecutions?</span>
        <span className={`font-medium ${formatYesNo(driverData.hasProsecution || driverData.insuranceData?.hasProsecution) === 'Yes' ? 'text-orange-600' : 'text-green-600'}`}>
          {formatYesNo(driverData.hasProsecution || driverData.insuranceData?.hasProsecution)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Any accidents in last 5 years?</span>
        <span className={`font-medium ${formatYesNo(driverData.hasAccidents || driverData.insuranceData?.hasAccidents) === 'Yes' ? 'text-orange-600' : 'text-green-600'}`}>
          {formatYesNo(driverData.hasAccidents || driverData.insuranceData?.hasAccidents)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Any insurance issues?</span>
        <span className={`font-medium ${formatYesNo(driverData.hasInsuranceIssues || driverData.insuranceData?.hasInsuranceIssues) === 'Yes' ? 'text-orange-600' : 'text-green-600'}`}>
          {formatYesNo(driverData.hasInsuranceIssues || driverData.insuranceData?.hasInsuranceIssues)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Any driving bans?</span>
        <span className={`font-medium ${formatYesNo(driverData.hasDrivingBan || driverData.insuranceData?.hasDrivingBan) === 'Yes' ? 'text-orange-600' : 'text-green-600'}`}>
          {formatYesNo(driverData.hasDrivingBan || driverData.insuranceData?.hasDrivingBan)}
        </span>
      </div>
    </div>
    
    {(driverData.additionalDetails || driverData.insuranceData?.additionalDetails) && (
      <div className="mt-3 pt-3 border-t">
        <span className="text-gray-600">Additional Details:</span>
        <p className="mt-1 text-sm">{driverData.additionalDetails || driverData.insuranceData?.additionalDetails}</p>
      </div>
    )}
  </div>
</div>

          {/* Document Status */}
<div className="mb-6 bg-gray-50 rounded-lg p-4">
  <div className="flex items-center mb-3">
    <FileText className="h-5 w-5 text-purple-600 mr-2" />
    <h3 className="text-lg font-semibold">Documents</h3>
  </div>
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-gray-700">Driving Licence</span>
      {driverData.documents?.license?.valid ? (
        <span className="flex items-center text-green-600">
          <Check className="h-4 w-4 mr-1" />
          Verified
        </span>
      ) : (
        <span className="flex items-center text-orange-600">
          <X className="h-4 w-4 mr-1" />
          Pending
        </span>
      )}
    </div>
    
    <div className="flex items-center justify-between">
      <span className="text-gray-700">Proof of Address 1</span>
      {driverData.documents?.poa1?.valid ? (
        <span className="flex items-center text-green-600">
          <Check className="h-4 w-4 mr-1" />
          Verified
        </span>
      ) : (
        <span className="flex items-center text-orange-600">
          <X className="h-4 w-4 mr-1" />
          Pending
        </span>
      )}
    </div>
    
    <div className="flex items-center justify-between">
      <span className="text-gray-700">Proof of Address 2</span>
      {driverData.documents?.poa2?.valid ? (
        <span className="flex items-center text-green-600">
          <Check className="h-4 w-4 mr-1" />
          Verified
        </span>
      ) : (
        <span className="flex items-center text-orange-600">
          <X className="h-4 w-4 mr-1" />
          Pending
        </span>
      )}
    </div>
    
    {/* Conditional: DVLA Check OR Passport based on license issuer */}
    {driverData.licenseIssuedBy === 'DVLA' ? (
      <div className="flex items-center justify-between">
        <span className="text-gray-700">DVLA Check</span>
        {driverData.documents?.dvlaCheck?.valid ? (
          <span className="flex items-center text-green-600">
            <Check className="h-4 w-4 mr-1" />
            Verified
          </span>
        ) : (
          <span className="flex items-center text-orange-600">
            <X className="h-4 w-4 mr-1" />
            Pending
          </span>
        )}
      </div>
    ) : (
      <div className="flex items-center justify-between">
        <span className="text-gray-700">Passport</span>
        {driverData.documents?.passportCheck?.valid || driverData.documents?.passport?.valid ? (
          <span className="flex items-center text-green-600">
            <Check className="h-4 w-4 mr-1" />
            Verified
          </span>
        ) : (
          <span className="flex items-center text-orange-600">
            <X className="h-4 w-4 mr-1" />
            Pending
          </span>
        )}
      </div>
    )}
  </div>
</div>

          {/* Declaration Text */}
<div className="mb-6 bg-gray-50 rounded-lg p-4">
  <h3 className="text-lg font-semibold mb-2">Declaration</h3>
  <p className="text-sm text-gray-700">
    <strong>By my signature, I acknowledge and confirm that:</strong>
  </p>
  <ul className="list-disc list-inside text-sm text-gray-700 mt-2 space-y-1">
    <li>All the information I have provided is true and accurate</li>
    <li>I have read and agree to the <a href="https://www.oooshtours.co.uk/files/Ooosh_vehicle_hire_terms.pdf" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-800 underline">terms and conditions of hire</a></li>
    <li>If I provide false information this insurance may be invalidated</li>
    <li>I am legally entitled to drive in the UK</li>
  </ul>
</div>

            {/* Signature Canvas */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2">Signature</h3>
              <div className="border-2 border-gray-300 rounded-lg p-2 bg-white">
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={200}
                  className="w-full cursor-crosshair touch-none"
                  style={{ maxWidth: '100%', height: 'auto' }}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                />
              </div>
              <div className="flex justify-between mt-2">
                <button
                  onClick={clearSignature}
                  disabled={!hasDrawn}
                  className="flex items-center text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Clear Signature
                </button>
                <p className="text-sm text-gray-500">
                  {signature ? 'Signature captured ✓' : hasDrawn ? 'Draw more to capture' : 'Please sign above'}
                </p>
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-center">
                  <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
                  <p className="text-red-800">{error}</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => window.history.back()}
                disabled={saving}
                className="flex-1 bg-gray-200 text-gray-700 py-3 px-4 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={saveSignatureAndComplete}
                disabled={!signature || saving}
                className="flex-1 bg-purple-600 text-white py-3 px-4 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                {saving ? (
                  <>
                    <Loader className="h-5 w-5 animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  'Complete Verification'
                )}
              </button>
            </div>

            {/* Terms Link */}
            <div className="mt-4 text-center text-sm text-gray-500">
              By completing this verification, you agree to our{' '}
              <a 
                href="https://www.oooshtours.co.uk/files/Ooosh_vehicle_hire_terms.pdf" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-purple-600 hover:text-purple-800 underline"
              >
                Terms & Conditions
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SignaturePage;
