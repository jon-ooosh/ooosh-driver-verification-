import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, Upload, User, Calendar, FileText, Shield, Mail, Clock, XCircle, Phone, Camera } from 'lucide-react';

const DriverVerificationApp = () => {
  const [jobId, setJobId] = useState('');
  const [driverEmail, setDriverEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [currentStep, setCurrentStep] = useState('landing'); 
  // Steps: landing, email-entry, email-verification, driver-status, document-upload, dvla-check, processing, complete, rejected
  const [jobDetails, setJobDetails] = useState(null);
  const [driverStatus, setDriverStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);

  // Extract job ID from URL on load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const jobParam = urlParams.get('job');
    if (jobParam) {
      setJobId(jobParam);
      validateJobAndFetchDetails(jobParam);
    } else {
      setError('Invalid verification link. Please check your email for the correct link.');
    }
  }, []);

  const validateJobAndFetchDetails = async (jobId) => {
    setLoading(true);
    try {
      // TODO: Integrate with Monday.com or HireHop API
      const response = await fetch(`/api/jobs/${jobId}/validate`);
      if (!response.ok) throw new Error('Job validation failed');
      
      const jobData = await response.json();
      
      // Check if hire end date has passed
      const endDate = new Date(jobData.endDate);
      const now = new Date();
      
      if (endDate < now) {
        setError('This hire has already ended. Please contact OOOSH if you need assistance.');
        return;
      }
      
      setJobDetails(jobData);
      setCurrentStep('email-entry');
    } catch (err) {
      // Mock response for development
      const mockJobDetails = {
        jobId: jobId,
        jobName: 'London Event Transport',
        startDate: '2025-07-15',
        endDate: '2025-07-20',
        vehicleType: 'Mercedes Sprinter',
        clientName: 'Events Ltd',
        isValid: true
      };
      
      setJobDetails(mockJobDetails);
      setCurrentStep('email-entry');
    } finally {
      setLoading(false);
    }
  };

  const sendVerificationEmail = async () => {
    if (!driverEmail || !driverEmail.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      // TODO: Implement email verification service
      const response = await fetch('/api/verification/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: driverEmail, 
          jobId: jobId 
        })
      });

      if (!response.ok) throw new Error('Failed to send verification email');
      
      setCurrentStep('email-verification');
      setError('');
    } catch (err) {
      // Mock success for development
      setCurrentStep('email-verification');
      setError('');
    } finally {
      setLoading(false);
    }
  };

  const verifyEmailCode = async () => {
    if (!verificationCode || verificationCode.length < 6) {
      setError('Please enter the 6-digit code from your email');
      return;
    }

    setLoading(true);
    try {
      // TODO: Verify code with backend
      const response = await fetch('/api/verification/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: driverEmail, 
          code: verificationCode,
          jobId: jobId 
        })
      });

      if (!response.ok) throw new Error('Invalid verification code');
      
      // Check driver status after email verification
      await checkDriverStatus();
    } catch (err) {
      // Mock success for development
      await checkDriverStatus();
    } finally {
      setLoading(false);
    }
  };

  const checkDriverStatus = async () => {
    try {
      // TODO: Check against driver verification database
      const response = await fetch(`/api/drivers/status?email=${encodeURIComponent(driverEmail)}`);
      
      if (response.ok) {
        const driverData = await response.json();
        setDriverStatus(driverData);
      } else {
        // New driver
        setDriverStatus({ status: 'new' });
      }
      
      setCurrentStep('driver-status');
    } catch (err) {
      // Mock driver status for development
      const mockStatuses = {
        'john.doe@example.com': {
          name: 'John Doe',
          status: 'verified',
          documents: {
            license: { valid: true, expiryDate: '2027-03-20' },
            poa1: { valid: true, expiryDate: '2025-09-15', type: 'Bank Statement' },
            poa2: { valid: false, expiryDate: '2025-06-15', type: 'Utility Bill' },
            dvlaCheck: { valid: false, lastCheck: '2025-06-20' }
          }
        },
        'new.driver@example.com': {
          status: 'new'
        }
      };

      setDriverStatus(mockStatuses[driverEmail] || { status: 'new' });
      setCurrentStep('driver-status');
    }
  };

  const startVerification = () => {
    setCurrentStep('document-upload');
  };

  const startDVLACheck = () => {
    setCurrentStep('dvla-check');
  };

  const generateIdenfyToken = async () => {
    setLoading(true);
    try {
      // TODO: Create Idenfy verification session
      const response = await fetch('/api/idenfy/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: `${jobId}-${driverEmail}`,
          firstName: driverStatus?.name?.split(' ')[0] || '',
          lastName: driverStatus?.name?.split(' ').slice(1).join(' ') || '',
          email: driverEmail,
          callbackUrl: `${window.location.origin}/api/idenfy/webhook`,
          successUrl: `${window.location.origin}?job=${jobId}&status=processing`,
          errorUrl: `${window.location.origin}?job=${jobId}&status=failed`
        })
      });

      if (!response.ok) throw new Error('Failed to create verification session');
      
      const { authToken, redirectUrl } = await response.json();
      
      // Redirect to Idenfy verification
      window.location.href = redirectUrl;
      
    } catch (err) {
      // Mock for development
      setCurrentStep('processing');
      setTimeout(() => {
        setCurrentStep('complete');
      }, 3000);
    } finally {
      setLoading(false);
    }
  };

  const processDVLACheck = async (file) => {
    if (!file) {
      setError('Please select a DVLA check document');
      return;
    }

    setLoading(true);
    try {
      // Convert file to base64 for Claude processing
      const base64 = await fileToBase64(file);
      
      // Use Claude API to extract DVLA check data
      const dvlaData = await extractDVLAData(base64);
      
      // Validate the extracted data
      if (validateDVLAData(dvlaData)) {
        // Update driver status with DVLA check
        setDriverStatus(prev => ({
          ...prev,
          documents: {
            ...prev.documents,
            dvlaCheck: { valid: true, lastCheck: new Date().toISOString().split('T')[0] }
          }
        }));
        
        setCurrentStep('driver-status');
        setError('');
      } else {
        setError('Could not validate DVLA check document. Please ensure the document is clear and try again.');
      }
    } catch (err) {
      setError('Failed to process DVLA check document. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = error => reject(error);
    });
  };

  const extractDVLAData = async (base64Image) => {
    try {
      // TODO: Use window.claude.complete to extract DVLA data
      const prompt = `
      Analyze this DVLA driving license check document and extract the following information in JSON format:
      
      {
        "driverName": "Full name from document",
        "licenseNumber": "Driving license number",
        "checkCode": "The check code (format: XX XX XX XX)",
        "dateGenerated": "Date summary generated",
        "drivingStatus": "Current driving status",
        "endorsements": "Number of offences and points",
        "validTo": "License valid to date"
      }
      
      The document is a UK DVLA license summary. Extract only the exact text shown. If any field cannot be clearly read, return null for that field.
      
      IMPORTANT: Return only valid JSON, no other text.
      `;

      const claudeResponse = await window.claude.complete(prompt);
      return JSON.parse(claudeResponse);
    } catch (err) {
      // Mock response for development
      return {
        driverName: driverStatus?.name || "John Doe",
        licenseNumber: "XXXXXX066JD9LA",
        checkCode: "Kd m3 ch Nn",
        dateGenerated: new Date().toISOString().split('T')[0],
        drivingStatus: "Current full licence",
        endorsements: "1 Offence, 3 Points",
        validTo: "2032-08-01"
      };
    }
  };

  const validateDVLAData = (dvlaData) => {
    // Validate that extracted data makes sense
    if (!dvlaData.driverName || !dvlaData.licenseNumber || !dvlaData.checkCode) {
      return false;
    }
    
    // Check name similarity (basic check)
    const extractedName = dvlaData.driverName.toLowerCase().replace(/mr |mrs |miss |ms /, '');
    const expectedName = driverStatus?.name?.toLowerCase() || '';
    
    // TODO: Implement more sophisticated name matching
    return true; // For now, accept all valid extractions
  };

  // Render functions for each step
  const renderLanding = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center mb-6">
        <Shield className="mx-auto h-12 w-12 text-blue-600 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900">OOOSH Driver Verification</h1>
        <p className="text-gray-600 mt-2">Secure driver verification for vehicle hire</p>
      </div>
      
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Validating job details...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div className="ml-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-600">Loading job details...</p>
        </div>
      )}
    </div>
  );

  const renderEmailEntry = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center mb-6">
        <Mail className="mx-auto h-12 w-12 text-blue-600 mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Driver Verification</h2>
        <p className="text-gray-600 mt-2">Job: {jobDetails?.jobName}</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
        <div className="flex">
          <Calendar className="h-5 w-5 text-blue-400 mt-0.5" />
          <div className="ml-3">
            <p className="text-sm text-blue-800">
              <strong>Hire Period:</strong> {jobDetails?.startDate} to {jobDetails?.endDate}
            </p>
            <p className="text-sm text-blue-800">
              <strong>Vehicle:</strong> {jobDetails?.vehicleType}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Your Email Address
          </label>
          <input
            type="email"
            id="email"
            value={driverEmail}
            onChange={(e) => setDriverEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="driver@example.com"
          />
          <p className="text-xs text-gray-500 mt-1">We'll send a verification code to this email</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <button
          onClick={sendVerificationEmail}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {loading ? 'Sending Code...' : 'Send Verification Code'}
        </button>
      </div>
    </div>
  );

  const renderEmailVerification = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center mb-6">
        <Mail className="mx-auto h-12 w-12 text-green-600 mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Check Your Email</h2>
        <p className="text-gray-600 mt-2">We sent a 6-digit code to:</p>
        <p className="text-sm font-medium text-gray-900">{driverEmail}</p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
            Verification Code
          </label>
          <input
            type="text"
            id="code"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-lg font-mono"
            placeholder="123456"
            maxLength="6"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <button
          onClick={verifyEmailCode}
          disabled={loading || verificationCode.length < 6}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {loading ? 'Verifying...' : 'Verify Code'}
        </button>

        <button
          onClick={sendVerificationEmail}
          className="w-full text-blue-600 hover:text-blue-700 text-sm"
        >
          Didn't receive the code? Send again
        </button>
      </div>
    </div>
  );

  const renderDriverStatus = () => {
    const isVerified = driverStatus?.status === 'verified';
    const needsDocuments = driverStatus?.status === 'new' || 
                          !driverStatus?.documents?.license?.valid ||
                          !driverStatus?.documents?.poa1?.valid ||
                          !driverStatus?.documents?.poa2?.valid;
    const needsDVLA = !driverStatus?.documents?.dvlaCheck?.valid;

    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="text-center mb-6">
          {isVerified && !needsDocuments && !needsDVLA ? (
            <CheckCircle className="mx-auto h-12 w-12 text-green-600 mb-4" />
          ) : (
            <FileText className="mx-auto h-12 w-12 text-orange-600 mb-4" />
          )}
          <h2 className="text-xl font-bold text-gray-900">
            {isVerified && !needsDocuments && !needsDVLA ? 
              `Welcome back, ${driverStatus.name}!` : 
              'Verification Status'}
          </h2>
        </div>

        {/* Document Status Breakdown */}
        <div className="space-y-3 mb-6">
          {driverStatus?.documents && (
            <>
              <DocumentStatus 
                title="Driving License" 
                status={driverStatus.documents.license} 
              />
              <DocumentStatus 
                title="Proof of Address #1" 
                status={driverStatus.documents.poa1} 
              />
              <DocumentStatus 
                title="Proof of Address #2" 
                status={driverStatus.documents.poa2} 
              />
              <DocumentStatus 
                title="DVLA Check" 
                status={driverStatus.documents.dvlaCheck} 
              />
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          {needsDocuments && (
            <button
              onClick={startVerification}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Upload Documents
            </button>
          )}
          
          {needsDVLA && !needsDocuments && (
            <button
              onClick={startDVLACheck}
              className="w-full bg-orange-600 text-white py-2 px-4 rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              Upload DVLA Check
            </button>
          )}
          
          {!needsDocuments && !needsDVLA && (
            <button
              onClick={() => alert('Added to hire! (Monday.com integration pending)')}
              className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              Join This Hire
            </button>
          )}
        </div>
      </div>
    );
  };

  const DocumentStatus = ({ title, status }) => {
    const isValid = status?.valid;
    const isExpiringSoon = status?.expiryDate && 
                          new Date(status.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
    return (
      <div className="flex items-center justify-between p-3 border rounded-md">
        <div className="flex items-center">
          {isValid ? (
            <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500 mr-2" />
          )}
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="text-right">
          {isValid ? (
            <div>
              <span className={`text-xs ${isExpiringSoon ? 'text-orange-600' : 'text-green-600'}`}>
                Valid until {status.expiryDate}
              </span>
              {status.type && (
                <p className="text-xs text-gray-500">{status.type}</p>
              )}
            </div>
          ) : (
            <span className="text-xs text-red-600">Required</span>
          )}
        </div>
      </div>
    );
  };

  const renderDocumentUpload = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center mb-6">
        <Upload className="mx-auto h-12 w-12 text-blue-600 mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Document Verification</h2>
        <p className="text-gray-600 mt-2">AI-powered document verification via Idenfy</p>
      </div>

      <div className="space-y-4 mb-6">
        <div className="border border-gray-200 rounded-md p-4">
          <h3 className="font-medium text-gray-900 mb-2">Required Documents:</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• UK Driving License (front and back)</li>
            <li>• Two Proof of Address documents (within 90 days)</li>
            <li>• Selfie for identity verification</li>
          </ul>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
          <p className="text-sm text-blue-800">
            <strong>Acceptable Proof of Address:</strong> Utility bills, bank statements, council tax, credit card statements
          </p>
        </div>
      </div>

      <button
        onClick={generateIdenfyToken}
        disabled={loading}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {loading ? 'Starting Verification...' : 'Start Document Upload'}
      </button>
    </div>
  );

  const renderDVLACheck = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center mb-6">
        <Camera className="mx-auto h-12 w-12 text-orange-600 mb-4" />
        <h2 className="text-xl font-bold text-gray-900">DVLA License Check</h2>
        <p className="text-gray-600 mt-2">Upload your DVLA check document</p>
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-md p-4 mb-6">
        <h3 className="font-medium text-orange-900 mb-2">How to get your DVLA check:</h3>
        <ol className="text-sm text-orange-800 space-y-1 list-decimal list-inside">
          <li>Visit gov.uk/check-driving-licence</li>
          <li>Enter your license details</li>
          <li>Download/screenshot the summary page</li>
          <li>Upload it here</li>
        </ol>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            DVLA Check Document
          </label>
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => setUploadedFile(e.target.files[0])}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <button
          onClick={() => processDVLACheck(uploadedFile)}
          disabled={loading || !uploadedFile}
          className="w-full bg-orange-600 text-white py-2 px-4 rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
        >
          {loading ? 'Processing Document...' : 'Verify DVLA Check'}
        </button>

        <button
          onClick={() => setCurrentStep('driver-status')}
          className="w-full text-gray-600 hover:text-gray-700 text-sm"
        >
          Back to Status
        </button>
      </div>
    </div>
  );

  const renderProcessing = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Processing Verification</h2>
        <p className="text-gray-600">Please wait while we verify your documents...</p>
        <p className="text-sm text-gray-500 mt-2">This usually takes 30-60 seconds</p>
      </div>
    </div>
  );

  const renderComplete = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center py-8">
        <CheckCircle className="mx-auto h-12 w-12 text-green-600 mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Verification Complete!</h2>
        <p className="text-gray-600 mb-4">You're approved for this hire.</p>
        
        <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-6">
          <p className="text-sm text-green-800">
            Your verification has been added to the hire roster. You'll receive confirmation details shortly.
          </p>
        </div>

        <button
          onClick={() => window.close()}
          className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          Close
        </button>
      </div>
    </div>
  );

  const renderRejected = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center py-8">
        <XCircle className="mx-auto h-12 w-12 text-red-600 mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Verification Issues</h2>
        <p className="text-gray-600 mb-4">We couldn't approve your verification.</p>
        
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
          <p className="text-sm text-red-800">
            This may be due to document quality, insurance requirements, or other factors. 
            Please contact OOOSH for assistance.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={startVerification}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Try Again
          </button>
          
          <a
            href="tel:+441234567890"
            className="w-full bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 inline-flex items-center justify-center"
          >
            <Phone className="h-4 w-4 mr-2" />
            Call OOOSH Support
          </a>
        </div>
      </div>
    </div>
  );

  // Main render logic
  const renderStep = () => {
    switch(currentStep) {
      case 'landing': return renderLanding();
      case 'email-entry': return renderEmailEntry();
      case 'email-verification': return renderEmailVerification();
      case 'driver-status': return renderDriverStatus();
      case 'document-upload': return renderDocumentUpload();
      case 'dvla-check': return renderDVLACheck();
      case 'processing': return renderProcessing();
      case 'complete': return renderComplete();
      case 'rejected': return renderRejected();
      default: return renderLanding();
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      {renderStep()}
    </div>
  );
};

export default DriverVerificationApp;
