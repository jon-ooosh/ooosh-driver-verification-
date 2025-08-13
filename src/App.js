// File: src/App.js
// OOOSH Driver Verification - Professional Clean Design
// FIXED: Removed unused Calendar import to resolve deployment error

import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, Upload, FileText, Shield, Mail, XCircle, Phone, Camera, ExternalLink } from 'lucide-react';

const DriverVerificationApp = () => {
  const [jobId, setJobId] = useState('');
  const [driverEmail, setDriverEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [currentStep, setCurrentStep] = useState('landing'); 
  // Steps: landing, email-entry, email-verification, insurance-questionnaire, driver-status, document-upload, dvla-check, processing, complete, rejected
  const [jobDetails, setJobDetails] = useState(null);
  const [driverStatus, setDriverStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  
  // Insurance questionnaire data
  const [insuranceData, setInsuranceData] = useState(null);

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

  // Check for verification complete callback from Idenfy
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get('status');
    const job = urlParams.get('job');
    const session = urlParams.get('session');
    
    if (status && job && ['success', 'error', 'unverified', 'mock'].includes(status)) {
      console.log('Verification complete callback:', { status, job, session });
      handleVerificationComplete(status, job, session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Disable exhaustive deps warning for this useEffect

  const validateJobAndFetchDetails = async (jobId) => {
    setLoading(true);
    try {
      console.log('Validating job:', jobId);
      
      // PRODUCTION: Call real job validation
      const response = await fetch(`/.netlify/functions/validate-job?jobId=${jobId}`);
      
      if (!response.ok) {
        throw new Error('Failed to validate job');
      }
      
      const result = await response.json();
      console.log('Job validation result:', result);
      
      if (!result.valid) {
        setError(result.message || 'This hire is no longer available for driver verification.');
        return;
      }
      
      setJobDetails(result.job);
      setCurrentStep('email-entry');
      setError('');
    } catch (err) {
      console.error('Job validation error:', err);
      setError('Failed to validate job. Please try again or contact support.');
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
    setError('');
    
    try {
      console.log('Sending verification email to:', driverEmail, 'for job:', jobId);
      
      const response = await fetch('/.netlify/functions/send-verification-code', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          email: driverEmail, 
          jobId: jobId 
        })
      });

      console.log('Response status:', response.status);

      const data = await response.json();
      console.log('Response data:', data);

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }
      
      setCurrentStep('email-verification');
      setError('');
      
      // Show helpful message for test emails
      if (data.testMode) {
        setError(''); // Clear any errors
        console.log('🚨 Test email detected - use any 6-digit code');
      }
      
    } catch (err) {
      console.error('Send verification error:', err);
      setError(`Failed to send verification email: ${err.message}`);
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
    setError('');
    
    try {
      console.log('Verifying code:', verificationCode, 'for email:', driverEmail);
      
      const response = await fetch('/.netlify/functions/verify-code', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          email: driverEmail, 
          code: verificationCode,
          jobId: jobId 
        })
      });

      const data = await response.json();
      console.log('Verify response:', data);

      // Check response status first, then handle data
      if (!response.ok) {
        // This handles 400 status responses (invalid codes)
        throw new Error(data.error || 'Verification failed');
      }

      // Only proceed if we have a successful response AND verification succeeded
      if (data.success && data.verified) {
        console.log('Verification successful, checking if returning driver');
        
        // Show test mode indicator if applicable
        if (data.testMode) {
          console.log('🚨 Test mode verification successful');
        }
        
        // First check if this is a returning driver
        await checkDriverStatus();
      } else {
        // This handles edge cases where status is 200 but verification failed
        throw new Error(data.error || 'Invalid verification code');
      }
      
    } catch (err) {
      console.error('Verify code error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const checkDriverStatus = async () => {
    try {
      console.log('Checking driver status for:', driverEmail);
      
      const response = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
      
      if (response.ok) {
        const driverData = await response.json();
        console.log('Driver status:', driverData);
        setDriverStatus(driverData);
        
        // Smart routing based on driver status
        if (driverData.status === 'verified') {
          // Returning driver with valid documents
          setCurrentStep('driver-status');
        } else if (driverData.status === 'partial') {
          // Returning driver but some documents expired
          setCurrentStep('driver-status');
        } else {
          // New driver - start with insurance questionnaire
          setCurrentStep('insurance-questionnaire');
        }
      } else {
        console.log('Driver not found, treating as new driver');
        setDriverStatus({ status: 'new', email: driverEmail });
        setCurrentStep('insurance-questionnaire');
      }
      
    } catch (err) {
      console.error('Error checking driver status:', err);
      setDriverStatus({ status: 'new', email: driverEmail });
      setCurrentStep('insurance-questionnaire');
    }
  };

  // Handle insurance questionnaire completion
  const handleInsuranceComplete = async (insuranceFormData) => {
    console.log('Insurance questionnaire completed:', insuranceFormData);
    setInsuranceData(insuranceFormData);
    
    // Save insurance data to Google Sheets via Apps Script
    try {
      setLoading(true);
      
      const response = await fetch('/.netlify/functions/save-insurance-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: driverEmail,
          jobId: jobId,
          insuranceData: insuranceFormData
        })
      });

      if (response.ok) {
        console.log('Insurance data saved successfully');
      } else {
        console.error('Failed to save insurance data');
      }
      
      // Move to driver status regardless of save success
      setCurrentStep('driver-status');
      
    } catch (err) {
      console.error('Error saving insurance data:', err);
      // Still proceed to next step
      setCurrentStep('driver-status');
    } finally {
      setLoading(false);
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
    setError('');
    
    try {
      console.log('Starting Idenfy verification for:', driverEmail);
      
      const response = await fetch('/.netlify/functions/create-idenfy-session', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          email: driverEmail, 
          jobId: jobId,
          driverName: driverStatus?.name 
        })
      });

      const data = await response.json();
      console.log('Idenfy session response:', data);

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }
      
      if (data.sessionToken && data.sessionToken.startsWith('mock_')) {
        // Mock mode - show processing then complete
        console.log('Mock Idenfy mode - simulating verification');
        setCurrentStep('processing');
        setTimeout(() => {
          setCurrentStep('complete');
        }, 3000);
      } else if (data.sessionToken) {
        // Real Idenfy mode - redirect to verification
        console.log('Redirecting to Idenfy verification');
        // Use the redirect URL from the response or construct the proper Idenfy UI URL
        window.location.href = data.redirectUrl || `https://ui.idenfy.com/session?authToken=${data.sessionToken}`;
      } else {
        throw new Error('No session token received from Idenfy');
      }
      
    } catch (err) {
      console.error('Idenfy error:', err);
      setError(`Failed to start document verification: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle verification complete callback from Idenfy
  const handleVerificationComplete = async (status, jobId, sessionId) => {
    console.log('Handling verification complete:', { status, jobId, sessionId });
    
    // Set loading state while we process the result
    setCurrentStep('processing');
    setError('');
    
    try {
      // Wait a bit for webhook to process (Idenfy webhooks can be delayed)
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check final driver status
      await checkDriverStatus();
      
      // Determine final step based on status
      switch (status) {
        case 'success':
          // Verification completed successfully
          if (driverStatus?.status === 'verified') {
            setCurrentStep('complete');
          } else if (driverStatus?.status === 'review_required') {
            setCurrentStep('processing'); // Still under review
          } else {
            // Check if we need DVLA check
            const needsDVLA = !driverStatus?.documents?.dvlaCheck?.valid;
            if (needsDVLA) {
              setCurrentStep('dvla-check');
            } else {
              setCurrentStep('driver-status');
            }
          }
          break;
          
        case 'error':
        case 'unverified':
          setCurrentStep('rejected');
          setError('Document verification failed. Please try again or contact support.');
          break;
          
        case 'mock':
          // Mock mode - simulate success
          setCurrentStep('complete');
          break;
          
        default:
          console.log('Unknown verification status:', status);
          setCurrentStep('driver-status');
      }
      
    } catch (err) {
      console.error('Error handling verification complete:', err);
      setError('Failed to process verification result. Please refresh and try again.');
      setCurrentStep('driver-status');
    }
  };

  const processDVLACheck = async (file) => {
    if (!file) {
      setError('Please select a DVLA check document');
      return;
    }

    setLoading(true);
    try {
      console.log('Processing DVLA check document:', file.name);
      
      // Convert file to base64 for Claude processing
      const base64 = await fileToBase64(file);
      
      // Use Claude API to extract DVLA check data
      const dvlaData = await extractDVLAData(base64);
      console.log('Extracted DVLA data:', dvlaData);
      
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
      console.error('DVLA processing error:', err);
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
      console.log('Extracting DVLA data from image...');
      
      // Mock response for development
      return {
        driverName: "John Doe",
        licenseNumber: "XXXXXX066JD9LA",
        checkCode: "Kd m3 ch Nn",
        dateGenerated: new Date().toISOString().split('T')[0],
        drivingStatus: "Current full licence",
        endorsements: "1 Offence, 3 Points",
        validTo: "2032-08-01"
      };
    } catch (err) {
      console.error('Claude extraction error:', err);
      throw new Error('Failed to extract data from document');
    }
  };

  const validateDVLAData = (dvlaData) => {
    if (!dvlaData.driverName || !dvlaData.licenseNumber || !dvlaData.checkCode) {
      return false;
    }
    return true;
  };

  // Insurance Questionnaire Component
  const InsuranceQuestionnaire = () => {
    const [formData, setFormData] = useState({
      hasDisability: null,
      hasConvictions: null,
      hasProsecution: null,
      hasAccidents: null,
      hasInsuranceIssues: null,
      hasDrivingBan: null,
      additionalDetails: ''
    });
    
    const [errors, setErrors] = useState({});

    const handleQuestionChange = (field, value) => {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
      
      // Clear error when user makes selection
      if (errors[field]) {
        setErrors(prev => ({ ...prev, [field]: null }));
      }
    };

    const validateQuestions = () => {
      const newErrors = {};
      
      // Check all yes/no questions are answered
      const requiredFields = [
        'hasDisability', 'hasConvictions', 'hasProsecution', 
        'hasAccidents', 'hasInsuranceIssues', 'hasDrivingBan'
      ];
      
      requiredFields.forEach(field => {
        if (formData[field] === null) {
          newErrors[field] = 'Please select an option';
        }
      });

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
      if (!validateQuestions()) return;

      try {
        const submissionData = {
          ...formData,
          email: driverEmail,
          jobId: jobId,
          submittedAt: new Date().toISOString()
        };

        // Call completion handler
        await handleInsuranceComplete(submissionData);
        
      } catch (error) {
        console.error('Submission error:', error);
        setErrors({ submit: 'Failed to submit questionnaire. Please try again.' });
      }
    };

    const YesNoQuestion = ({ field, question, required = true }) => (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          {question} {required && <span className="text-red-500">*</span>}
        </label>
        <div className="flex space-x-4">
          <label className="flex items-center">
            <input
              type="radio"
              name={field}
              value="yes"
              checked={formData[field] === 'yes'}
              onChange={(e) => handleQuestionChange(field, 'yes')}
              className="mr-2"
            />
            Yes
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              name={field}
              value="no"
              checked={formData[field] === 'no'}
              onChange={(e) => handleQuestionChange(field, 'no')}
              className="mr-2"
            />
            No
          </label>
        </div>
        {errors[field] && (
          <p className="text-sm text-red-600">{errors[field]}</p>
        )}
      </div>
    );

    return (
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="text-center mb-6">
          <FileText className="mx-auto h-12 w-12 text-purple-600 mb-4" />
          <h2 className="text-xl font-bold text-gray-900">Insurance Questions</h2>
          <p className="text-gray-600 mt-2">Required for insurance compliance</p>
        </div>

        <div className="space-y-6">
          {/* Insurance Questions */}
          <div className="bg-purple-50 border border-purple-200 rounded-md p-4">
            <h3 className="font-medium text-purple-900 mb-4">Health & Driving History</h3>
            <div className="space-y-4">
              <YesNoQuestion
                field="hasDisability"
                question="Have you any physical or mental disability or infirmity, or been told by your doctor not to drive, even temporarily?"
              />
              
              <YesNoQuestion
                field="hasConvictions"
                question="Have you ever had a BA, DD, DR, UT, MS90, MS30, IN10, CU80, TT99, or CD conviction, or a single SP offence yielding 6 or more points?"
              />
              
              <YesNoQuestion
                field="hasProsecution"
                question="Have you in the past 5 years been convicted of any of the following offences: manslaughter, causing death by dangerous driving, driving whilst under the influence of drink or drugs, failing to stop after and/or report an accident to police or any combination of offences that have resulted in suspension or disqualification from driving?"
              />
              
              <YesNoQuestion
                field="hasAccidents"
                question="Have you been involved in any motoring accidents in the past three years?"
              />
              
              <YesNoQuestion
                field="hasInsuranceIssues"
                question="Have you ever been refused motor insurance or had any special terms or premiums imposed?"
              />
              
              <YesNoQuestion
                field="hasDrivingBan"
                question="Have you been banned or disqualified from driving in the past 5 years?"
              />
            </div>
          </div>

          {/* Additional Details */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Additional Information (Optional)
            </label>
            <textarea
              value={formData.additionalDetails}
              onChange={(e) => handleQuestionChange('additionalDetails', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Please provide any additional details about your answers above..."
            />
          </div>

          {/* Info about POA - No upload needed */}
          <div className="bg-purple-50 border border-purple-200 rounded-md p-4">
            <h3 className="font-medium text-purple-900 mb-2">📄 Proof of Address Requirements</h3>
            <p className="text-sm text-purple-800">
              <strong>Note:</strong> You'll be asked to upload proof of address documents during the next step (document verification). 
              Please have ready: utility bills, bank statements, council tax, or credit card statements from the last 90 days.
            </p>
          </div>

          {/* Error Display */}
          {errors.submit && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-red-400" />
                <div className="ml-3">
                  <p className="text-sm text-red-800">{errors.submit}</p>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex space-x-3">
            <button
              onClick={() => setCurrentStep('email-verification')}
              className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              className="flex-1 bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700"
            >
              Continue to Documents
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Render functions for each step
  const renderLanding = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center mb-6">
        <Shield className="mx-auto h-12 w-12 text-purple-600 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900">OOOSH Driver Verification</h1>
        <p className="text-gray-600 mt-2">Secure driver verification for vehicle hire</p>
      </div>
      
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
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
    <div className="min-h-screen bg-gray-50">
      {/* Header with Logo */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <img 
                src="https://www.oooshtours.co.uk/images/ooosh-tours-logo.png" 
                alt="OOOSH Tours" 
                className="h-8 w-auto"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto pt-8 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          
          {/* Header Section */}
          <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-2">
              Hire Agreement - Proposal for Insurance
            </h1>
            <p className="text-purple-100">
              Complete your driver verification to join this hire
            </p>
          </div>

          {/* Job Details Section */}
          <div className="bg-gradient-to-r from-purple-50 to-purple-100 px-6 py-6 border-b border-purple-200">
            <h2 className="text-lg font-semibold text-purple-900 mb-3">Booking Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-purple-700 font-medium">Job ID</p>
                <p className="text-purple-900 font-semibold">{jobDetails?.jobNumber || jobId}</p>
              </div>
              <div>
                <p className="text-sm text-purple-700 font-medium">Customer</p>
                <p className="text-purple-900 font-semibold">{jobDetails?.customer || 'Loading...'}</p>
              </div>
              <div>
                <p className="text-sm text-purple-700 font-medium">Hire Period</p>
                <p className="text-purple-900 font-semibold">
                  {jobDetails?.startDate && jobDetails?.endDate ? 
                    `${jobDetails.startDate} to ${jobDetails.endDate}` : 
                    'Loading dates...'}
                </p>
              </div>
              <div>
                <p className="text-sm text-purple-700 font-medium">Status</p>
                <p className="text-purple-900 font-semibold">{jobDetails?.status || 'Confirmed'}</p>
              </div>
            </div>
          </div>

          {/* Email Entry Section */}
          <div className="px-6 py-8">
            <div className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Your Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={driverEmail}
                  onChange={(e) => setDriverEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="driver@example.com"
                />
                <p className="text-xs text-gray-500 mt-2">We'll send a verification code to this email address</p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex">
                    <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
                    <div className="ml-3">
                      <p className="text-sm text-red-800">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={sendVerificationEmail}
                disabled={loading}
                className="w-full bg-purple-600 text-white py-3 px-6 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 font-medium"
              >
                {loading ? 'Sending Code...' : 'Send Verification Code'}
              </button>
            </div>
          </div>

          {/* Requirements Section */}
          <div className="bg-gray-50 px-6 py-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">What You'll Need</h3>
            
            <div className="space-y-4 text-sm text-gray-600">
              <div>
                <h4 className="font-medium text-gray-800 mb-2">🆔 UK Driving License Requirements:</h4>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Valid UK photocard driving license (front and back photos)</li>
                  <li>Must be valid for the hire period</li>
                  <li>License held for minimum 2 years</li>
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-gray-800 mb-2">🏠 Proof of Address (2 required):</h4>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Bank statements, utility bills, council tax, or credit card statements</li>
                  <li>Must be within the last 90 days</li>
                  <li>Must show your current home address</li>
                  <li>Documents must be from different sources</li>
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-gray-800 mb-2">🔍 DVLA Check:</h4>
                <p className="ml-5">
                  Current DVLA license check from{' '}
                  <a 
                    href="https://www.gov.uk/check-driving-licence" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-purple-600 hover:text-purple-800 inline-flex items-center"
                  >
                    gov.uk/check-driving-licence <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </p>
              </div>

              <div>
                <h4 className="font-medium text-gray-800 mb-2">📋 Insurance Questions:</h4>
                <p className="ml-5">Complete health and driving history questionnaire for insurance compliance</p>
              </div>

              <div>
                <h4 className="font-medium text-gray-800 mb-2">✍️ Digital Signature:</h4>
                <p className="ml-5">Electronic signature on driver declaration and terms & conditions</p>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Need help?</span>
                <a 
                  href="tel:01273911382" 
                  className="text-purple-600 hover:text-purple-800 inline-flex items-center"
                >
                  <Phone className="h-3 w-3 mr-1" />
                  01273 911382
                </a>
              </div>
              
              <div className="mt-2 text-xs text-gray-500">
                <a 
                  href="https://www.oooshtours.co.uk/driver-guide" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:text-purple-800 inline-flex items-center"
                >
                  Driver Guide <ExternalLink className="h-3 w-3 ml-1" />
                </a>
                {' | '}
                <a 
                  href="https://www.oooshtours.co.uk/terms" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:text-purple-800 inline-flex items-center"
                >
                  Terms & Conditions <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </div>
            </div>
          </div>
        </div>
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
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-center text-lg font-mono"
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
          className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
        >
          {loading ? 'Verifying...' : 'Verify Code'}
        </button>

        <button
          onClick={sendVerificationEmail}
          disabled={loading}
          className="w-full text-purple-600 hover:text-purple-700 text-sm disabled:opacity-50"
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
              `Welcome back!` : 
              'Verification Status'}
          </h2>
          {insuranceData && (
            <p className="text-sm text-green-600 mt-1">✓ Insurance questions completed</p>
          )}
        </div>

        {/* Document Status Breakdown */}
        {driverStatus?.documents && (
          <div className="space-y-3 mb-6">
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
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          {needsDocuments && (
            <button
              onClick={startVerification}
              className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
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
              {status.expiryDate && (
                <span className={`text-xs ${isExpiringSoon ? 'text-orange-600' : 'text-green-600'}`}>
                  Valid until {status.expiryDate}
                </span>
              )}
              {status.lastCheck && !status.expiryDate && (
                <span className="text-xs text-green-600">
                  Checked {status.lastCheck}
                </span>
              )}
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
        <Upload className="mx-auto h-12 w-12 text-purple-600 mb-4" />
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

        <div className="bg-purple-50 border border-purple-200 rounded-md p-3">
          <p className="text-sm text-purple-800">
            <strong>Acceptable Proof of Address:</strong> Utility bills, bank statements, council tax, credit card statements
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <button
        onClick={generateIdenfyToken}
        disabled={loading}
        className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
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
            className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            Try Again
          </button>
          
          <a
            href="tel:01273911382"
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
      case 'insurance-questionnaire': return <InsuranceQuestionnaire />;
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
    <>
      {/* Favicon */}
      <link rel="icon" type="image/png" href="https://www.oooshtours.co.uk/images/ooosh-tours-logo.png" />
      
      {currentStep === 'email-entry' ? (
        renderStep()
      ) : (
        <div className="min-h-screen bg-gray-100 py-8">
          {renderStep()}
        </div>
      )}
    </>
  );
};

export default DriverVerificationApp;
