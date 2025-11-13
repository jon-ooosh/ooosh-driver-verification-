// File: src/App.js
// ooosh Tours Driver Verification - PRODUCTION READY v2.0
// Phase 1 Security: Session tokens, step validation, timeout handling, clean logging

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle, CheckCircle, Upload, FileText, Mail, XCircle, Phone, ExternalLink, Smartphone, User } from 'lucide-react';
import DVLAProcessingPage from './DVLAProcessingPage';
import POAValidationPage from './POAValidationPage';
import PassportUploadPage from './PassportUploadPage';
import ProcessingHub from './ProcessingHub';
import SignaturePage from './SignaturePage';

const DriverVerificationApp = () => {
  const [jobId, setJobId] = useState('');
  const [driverEmail, setDriverEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+44');
  const [phoneNumber, setPhoneNumber] = useState(''); 
  const [verificationCode, setVerificationCode] = useState('');
  const [currentStep, setCurrentStep] = useState('landing');
  const [jobDetails, setJobDetails] = useState(null);
  const [driverStatus, setDriverStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  // ✨ NEW: Session security - Initialize session token in sessionStorage
  useEffect(() => {
    const existing = sessionStorage.getItem('verificationSessionToken');
    if (!existing) {
      const newToken = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('verificationSessionToken', newToken);
      sessionStorage.setItem('sessionStartTime', Date.now().toString());
      console.log('🔒 New session initialized');
    }
  }, []);

  // Scroll position maintenance
  const scrollPositionRef = useRef(0);
  const formContainerRef = useRef(null);

  // Save and restore scroll position
  const preserveScrollPosition = () => {
    if (formContainerRef.current) {
      scrollPositionRef.current = window.scrollY;
    }
  };

  const restoreScrollPosition = () => {
    setTimeout(() => {
      if (scrollPositionRef.current > 0) {
        window.scrollTo(0, scrollPositionRef.current);
      }
    }, 0);
  };
  
  const calculateExpiryDate = (daysToAdd) => {
    const date = new Date();
    date.setDate(date.getDate() + daysToAdd);
    return date.toISOString().split('T')[0];
  };

  const updateDriverData = async (updates) => {
    try {
      const response = await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-driver-board-a',
          email: driverEmail,
          updates: updates
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update driver data');
      }
      
      return await response.json();
    } catch (error) {
      console.error('❌ Error updating driver data:', error.message);
      throw error;
    }
  };

  // 🔒 SECURITY: Validate signature page access
  const validateSignatureAccess = async (email, job) => {
    try {
      setLoading(true);
      console.log('🔒 Validating signature page access');
      
      // Check driver status from server
      const response = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(email)}`);
      
      if (!response.ok) {
        throw new Error('Driver not found');
      }
      
      const driverData = await response.json();
      setDriverStatus(driverData);
      
      // 🔒 SECURITY: Verify all documents are valid
      const docs = driverData.documents || {};
      const allDocsValid = 
        docs.license?.valid &&
        docs.poa1?.valid &&
        docs.poa2?.valid &&
        docs.dvlaCheck?.valid;
      
      const hasInsuranceData = !!driverData.insuranceData;
      
      if (allDocsValid && hasInsuranceData) {
        console.log('✅ Driver verified - signature page access granted');
        handleStepChange('signature');
      } else {
        console.warn('⚠️ Driver not fully verified - redirecting to processing-hub');
        // Redirect to processing hub to complete missing steps
        window.location.href = `/?step=processing-hub&email=${encodeURIComponent(email)}&job=${job || ''}`;
      }
      
    } catch (error) {
      console.error('❌ Signature access validation failed:', error.message);
      setError('Unable to verify driver status. Please complete the verification process.');
      handleStepChange('email-entry');
    } finally {
      setLoading(false);
    }
  };

  // ✨ NEW: Session timeout check (30 minutes)
  useEffect(() => {
    const checkSession = () => {
      const startTime = sessionStorage.getItem('sessionStartTime');
      if (!startTime) return;
      
      const elapsed = Date.now() - parseInt(startTime);
      const thirtyMinutes = 30 * 60 * 1000;
      
      if (elapsed > thirtyMinutes && currentStep !== 'complete') {
        console.log('⏱️ Session expired - resetting');
        sessionStorage.clear();
        setError('Your session has expired for security. Please start again.');
        window.location.href = '/';
      }
    };
    
    // Check every minute
    const interval = setInterval(checkSession, 60000);
    return () => clearInterval(interval);
  }, [currentStep]);

  // ✨ NEW: Step validation - prevents URL manipulation
  const isValidStepTransition = useCallback((requestedStep) => {
    const stepOrder = [
      'landing',
      'email-entry',
      'email-verification',
      'contact-details',
      'insurance-questionnaire',
      'document-upload',
      'processing-hub',
      'poa-validation',
      'dvla-processing',
      'passport-upload',
      'signature',
      'complete',
      'rejected'
    ];
    
    const currentIndex = stepOrder.indexOf(currentStep);
    const requestedIndex = stepOrder.indexOf(requestedStep);
    
    // 🔒 SECURITY: ProcessingHub routing pages - but NOT signature
    // These can be accessed via URL from ProcessingHub
    if (['processing-hub', 'poa-validation', 'dvla-processing', 'passport-upload'].includes(requestedStep)) {
      return true;
    }
    
    // 🔒 SECURITY: Signature page requires server-side validation
    // Will be validated in the URL handler before allowing access
    if (requestedStep === 'signature') {
      return true; // Validated separately with driver status check
    }
    
    // Can go backward or forward one step at a time
    if (requestedIndex <= currentIndex) {
      return true; // Backward navigation allowed
    }
    
    if (requestedIndex === currentIndex + 1) {
      return true; // Forward one step allowed
    }
    
    // 🔒 SECURITY: Block jumping ahead
    console.warn('⚠️ Invalid step transition blocked:', currentStep, '→', requestedStep);
    return false;
  }, [currentStep]);

  // 🔒 SECURITY: Validated step transition handler
  const handleStepChange = useCallback((nextStep) => {
    if (!isValidStepTransition(nextStep)) {
      setError('Invalid navigation detected. Please follow the verification steps in order.');
      return;
    }
    
    // 🧹 CLEANUP: Minimal logging
    console.log('✅ Step transition:', currentStep, '→', nextStep);
    setCurrentStep(nextStep);
    setError(''); // Clear any previous errors
  }, [currentStep, isValidStepTransition]);
  
  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      const isMobileDevice = /android|iPhone|iPad|iPod|blackberry|iemobile|opera mini/i.test(userAgent);
      const isSmallScreen = window.innerWidth <= 768;
      setIsMobile(isMobileDevice || isSmallScreen);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Add Montserrat font
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    
    document.body.style.fontFamily = "'Montserrat', sans-serif";
        
    return () => {
      document.head.removeChild(link);
      document.body.style.fontFamily = '';
    };
  }, []);

  // Extract job ID from URL on load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const jobParam = urlParams.get('job');
    const emailParam = urlParams.get('email');
    const stepParam = urlParams.get('step');
    
    // 🧹 CLEANUP: Minimal URL logging
    console.log('📍 Loading verification:', { step: stepParam, hasEmail: !!emailParam, hasJob: !!jobParam });
    
    // Handle direct navigation to specific steps
    if (stepParam === 'processing-hub' && emailParam) {
      setDriverEmail(decodeURIComponent(emailParam));
      if (jobParam) setJobId(jobParam);
      handleStepChange('processing-hub');
      return;
    }
    
    if (stepParam === 'dvla-processing' && emailParam) {
      setDriverEmail(decodeURIComponent(emailParam));
      if (jobParam) setJobId(jobParam);
      handleStepChange('dvla-processing');
      return;
    }

    if (stepParam === 'poa-validation' && emailParam) {
      setDriverEmail(decodeURIComponent(emailParam));
      if (jobParam) setJobId(jobParam);
      handleStepChange('poa-validation');
      return;
    }
    
    if (stepParam === 'passport-upload' && emailParam) {
      setDriverEmail(decodeURIComponent(emailParam));
      if (jobParam) setJobId(jobParam);
      handleStepChange('passport-upload');
      return;
    }
    
    if (stepParam === 'signature' && emailParam) {
      console.log('🔒 Signature page access attempt - validating');
      setDriverEmail(decodeURIComponent(emailParam));
      if (jobParam) setJobId(jobParam);
      // 🔒 SECURITY: Validate before allowing access
      validateSignatureAccess(decodeURIComponent(emailParam), jobParam);
      return;
    }
    
    // Handle normal job flow
    if (jobParam) {
      setJobId(jobParam);
      validateJobAndFetchDetails(jobParam);
    } else {
      setError('Invalid verification link. Please check your email for the correct link.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check for verification complete callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get('status');
    const job = urlParams.get('job');
    const email = urlParams.get('email');
    const session = urlParams.get('session');
    const step = urlParams.get('step');
    
    if (step === 'processing-hub') {
      return;
    }
    
    if (status && job && ['success', 'error', 'unverified'].includes(status)) {
      if (email) {
        setDriverEmail(decodeURIComponent(email));
      }
      
      setTimeout(() => {
        handleVerificationComplete(status, job, session);
      }, 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateJobAndFetchDetails = async (jobIdParam) => {
    setLoading(true);
    try {
      const response = await fetch(`/.netlify/functions/validate-job?jobId=${jobIdParam}`);
      
      if (!response.ok) {
        throw new Error('Failed to validate job');
      }
      
      const result = await response.json();
      
      if (!result.valid) {
        setError(result.message || 'This hire is no longer available for driver verification.');
        return;
      }
      
      setJobDetails(result.job);
      handleStepChange('email-entry');
      setError('');
    } catch (err) {
      console.error('❌ Job validation error:', err.message);
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
      // 🧹 CLEANUP: Removed detailed logging
      console.log('📧 Sending verification code');
      
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }
      
      handleStepChange('email-verification');
      
      // 🔒 SECURITY: Removed test mode logging
      
    } catch (err) {
      console.error('❌ Send verification error:', err.message);
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

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      if (data.success && data.verified) {
        console.log('✅ Email verified');
        
        // 🔒 SECURITY: Removed test mode logging
        
        await checkDriverStatusEarly();
      } else {
        throw new Error(data.error || 'Invalid verification code');
      }
      
    } catch (err) {
      console.error('❌ Verify code error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const checkDriverStatusEarly = async () => {
    try {
      const response = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
      
      if (response.ok) {
        const driverData = await response.json();
        console.log('✅ Driver status retrieved');
        setDriverStatus(driverData);
        
        // Pre-populate phone if we have it
        if (driverData.phoneNumber) {
          setPhoneNumber(driverData.phoneNumber);
        }
        if (driverData.phoneCountry) {
          setCountryCode(driverData.phoneCountry);
        }
        
        // Check document validity
        if (driverData.status === 'verified' && driverData.documents) {
          const licenceValid = driverData.documents.licence?.valid;
          const poa1Valid = driverData.documents.poa1?.valid;
          const poa2Valid = driverData.documents.poa2?.valid;
          const dvlaValid = driverData.documents.dvlaCheck?.valid;
          
          if (licenceValid && poa1Valid && poa2Valid && dvlaValid) {
            if (driverData.insuranceData && !needsInsuranceQuestionnaire()) {
              handleStepChange('document-upload');
              return;
            }
          }
        }
        
        handleStepChange('contact-details');
      } else {
        setDriverStatus({ status: 'new', email: driverEmail });
        handleStepChange('contact-details');
      }
      
    } catch (err) {
      console.error('❌ Error checking driver status:', err.message);
      setDriverStatus({ status: 'new', email: driverEmail });
      handleStepChange('contact-details');
    }
  };

  const saveContactDetails = async () => {
    if (!phoneNumber || phoneNumber.length < 9) {
      setError('Please enter a valid phone number');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'create-driver-board-a',
          email: driverEmail,
          driverData: {
            phoneNumber: phoneNumber,
            phoneCountry: countryCode
          }
        })
      });

      if (response.ok) {
        console.log('✅ Contact details saved');
      } else {
        console.error('⚠️ Failed to save contact details - continuing');
      }
      
      handleStepChange('insurance-questionnaire');
      
    } catch (err) {
      console.error('❌ Error saving contact details:', err.message);
      handleStepChange('insurance-questionnaire');
    } finally {
      setLoading(false);
    }
  };

  const needsInsuranceQuestionnaire = () => {
    return true; // Always require for new hires
  };

  const checkDriverStatus = async () => {
    try {
      const response = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
      
      if (response.ok) {
        const driverData = await response.json();
        console.log('✅ Driver status retrieved');
        setDriverStatus(driverData);
        
        // Routing logic
        if (driverData?.status === 'verified' || 
            (driverData?.documents?.license?.valid && 
             driverData?.documents?.poa1?.valid && 
             driverData?.documents?.poa2?.valid && 
             driverData?.documents?.dvlaCheck?.valid)) {
          handleStepChange('complete');
        } else if (driverData.status === 'partial') {
          handleStepChange('document-upload');
        } else if (!needsInsuranceQuestionnaire()) {
          handleStepChange('document-upload');
        } else {
          handleStepChange('insurance-questionnaire');
        }
      } else {
        setDriverStatus({ status: 'new', email: driverEmail });
        handleStepChange('insurance-questionnaire');
      }
      
    } catch (err) {
      console.error('❌ Error checking driver status:', err.message);
      setDriverStatus({ status: 'new', email: driverEmail });
      handleStepChange('insurance-questionnaire');
    }
  };
      
  const handleInsuranceComplete = async (insuranceFormData) => {
    console.log('✅ Insurance questionnaire completed');
    setLoading(true);
    
    try {
      // Save insurance data to Monday.com
      const response = await fetch('/.netlify/functions/monday-integration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'update-driver-board-a',
          email: driverEmail,
          updates: {
            datePassedTest: insuranceFormData.datePassedTest,
            hasDisability: insuranceFormData.hasDisability === 'yes',
            hasConvictions: insuranceFormData.hasConvictions === 'yes',
            hasProsecution: insuranceFormData.hasProsecution === 'yes',
            hasAccidents: insuranceFormData.hasAccidents === 'yes',
            hasInsuranceIssues: insuranceFormData.hasInsuranceIssues === 'yes',
            hasDrivingBan: insuranceFormData.hasDrivingBan === 'yes',
            additionalDetails: insuranceFormData.additionalDetails || ''
          }
        })
      });

      if (response.ok) {
        console.log('✅ Insurance data saved');
      } else {
        console.error('⚠️ Failed to save insurance data');
      }
      
      console.log('🚀 Calling centralized router');
      
      const routerResponse = await fetch('/.netlify/functions/get-next-step', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: driverEmail,
          currentStep: 'insurance-complete'
        })
      });
      
      if (routerResponse.ok) {
        const routerData = await routerResponse.json();
        console.log('✅ Router response:', routerData.nextStep);
        
        const nextStep = routerData.nextStep;
        
        // Map router steps to App.js steps
        switch(nextStep) {
          case 'full-idenfy':
          case 'selective-idenfy':
            handleStepChange('document-upload');
            break;
          case 'dvla-check':
            window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
            break;
          case 'poa-validation':
            window.location.href = `/?step=poa-validation&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
            break;
          case 'passport-upload':
            window.location.href = `/?step=passport-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
            break;
          case 'signature':
            handleStepChange('signature');
            break;
          default:
            handleStepChange('document-upload');
        }
      } else {
        console.error('❌ Router call failed, using fallback');
        handleStepChange('document-upload');
      }
        
    } catch (err) {
      console.error('❌ Error in insurance completion:', err.message);
      handleStepChange('document-upload');
    } finally {
      setLoading(false);
    }
  };

  const startVerification = () => {
    generateIdenfyToken();
  };

  const startAgain = () => {
    // 🔒 SECURITY: Clear session on restart
    sessionStorage.clear();
    
    setDriverEmail('');
    setPhoneNumber('');
    setCountryCode('+44');
    setVerificationCode('');
    setError('');
    setLoading(false);
    handleStepChange('email-entry');
  };

  const generateIdenfyToken = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Determine verification type
      let verificationType = 'full';
      const docs = driverStatus?.documents;
      
      if (docs) {
        const licenseValid = docs.license?.valid;
        const poa1Valid = docs.poa1?.valid;
        const poa2Valid = docs.poa2?.valid;
        
        if (!licenseValid && poa1Valid && poa2Valid) {
          verificationType = 'license';
        } else if (licenseValid && !poa1Valid && poa2Valid) {
          verificationType = 'poa1';
        } else if (licenseValid && poa1Valid && !poa2Valid) {
          verificationType = 'poa2';
        } else if (licenseValid && !poa1Valid && !poa2Valid) {
          verificationType = 'poa_both';
        } else {
          verificationType = 'full';
        }
      }
      
      const isUKDriver = driverStatus?.licenseIssuedBy === 'UK' || true;
      
      const response = await fetch('/.netlify/functions/create-idenfy-session', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          email: driverEmail, 
          jobId: jobId,
          driverName: driverStatus?.name,
          verificationType: verificationType,
          isUKDriver: isUKDriver
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }
      
      // 🔒 SECURITY: Removed mock mode handling
      if (data.sessionToken) {
        console.log('✅ Redirecting to Idenfy verification');
        window.location.href = data.redirectUrl || `https://ui.idenfy.com/session?authToken=${data.sessionToken}`;
      } else {
        throw new Error('No session token received from Idenfy');
      }
      
    } catch (err) {
      console.error('❌ Idenfy error:', err.message);
      setError(`Failed to start document verification: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleVerificationComplete = async (status, jobIdParam, sessionId) => {
    console.log('✅ Verification complete:', status);
    
    handleStepChange('processing');
    setError('');
    
    try {
      // Wait for webhook to process
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      await checkDriverStatus();
      
      const response = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
      if (response.ok) {
        const freshData = await response.json();
        setDriverStatus(freshData);
        
        // Check for UK driver
        const isUKDriver = freshData?.nationality === 'GB' || 
                          freshData?.nationality === 'United Kingdom' ||
                          freshData?.licenseIssuedBy === 'DVLA' ||
                          freshData?.licenseIssuedBy?.includes('GB') ||
                          freshData?.licenseIssuedBy?.includes('UK');
        
        console.log('🔍 UK driver check:', isUKDriver);
        
        // Handle routing based on status
        switch (status) {
          case 'success':
          case 'error':
          case 'unverified':
            handleStepChange('processing-hub');
            break;
          case 'rejected':
            handleStepChange('rejected');
            setError('Document verification failed. Please try again or contact support.');
            break;
          default:
            break;
        }
      }  
    } catch (err) {
      console.error('❌ Error handling verification complete:', err.message);
      setError('Failed to process verification result. Please refresh and try again.');
      handleStepChange('document-upload');
    }
  };

  const handleDVLAUpload = async (dvlaFile) => {
    try {
      setLoading(true);
      console.log('📄 Processing DVLA document');
      
      // Convert file to base64
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(dvlaFile);
      });
      
      // Process with AWS Textract
      const response = await fetch('/.netlify/functions/document-processor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testType: 'dvla',
          imageData: fileData.split(',')[1],
          documentType: 'dvla',
          licenseAddress: driverStatus?.licenseAddress,
          fileType: dvlaFile.type.includes('pdf') ? 'pdf' : 'image'
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('✅ DVLA processing successful');
        
        // Update Monday.com with DVLA results
        await updateDriverData({
          dvlaProcessingResult: JSON.stringify(result.result),
          dvlaValidUntil: calculateExpiryDate(90),
          overallStatus: result.result.decision === 'APPROVED' ? 'Done' : 'Stuck'
        });
        
        handleStepChange('complete');
      } else {
        throw new Error(result.error || 'DVLA processing failed');
      }
      
    } catch (error) {
      console.error('❌ DVLA upload error:', error.message);
      setError(`Failed to process DVLA document: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };
 
  const generateQRCode = () => {
    const currentUrl = window.location.href;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(currentUrl)}`;
    return qrUrl;
  };

  const formatHireDate = (dateString) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      
      const day = date.getDate();
      const month = date.toLocaleDateString('en-GB', { month: 'long' });
      
      const getOrdinalSuffix = (day) => {
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
          case 1: return 'st';
          case 2: return 'nd';
          case 3: return 'rd';
          default: return 'th';
        }
      };
      
      return `9am ${day}${getOrdinalSuffix(day)} ${month}`;
    } catch (error) {
      console.error('❌ Date formatting error:', error.message);
      return dateString;
    }
  };

  const getDocVerificationLabel = (driverStatus) => {
    const isUK = driverStatus?.licenseIssuedBy?.includes('UK') || 
                 driverStatus?.licenseIssuedBy?.includes('DVLA') ||
                 driverStatus?.licenseIssuedBy?.includes('GB') ||
                 driverStatus?.nationality === 'GB' ||
                 driverStatus?.nationality === 'United Kingdom';
    return isUK ? 'DVLA check' : 'Passport';
  };

  const getDocumentStatus = (doc) => {
    if (!doc) return 'Required';
    if (doc.valid) return 'Valid';
    if (doc.expiryDate) {
      return 'Expired - needs renewal';
    }
    return 'Required';
  };

  const handleCountryChange = (e) => {
    setCountryCode(e.target.value);
  };

  // Contact Details Component
  const ContactDetails = () => {
    const isReturningDriver = driverStatus?.status !== 'new';
    
    return (
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6" ref={formContainerRef}>
        <div className="text-center mb-6">
          <User className="mx-auto h-12 w-12 text-purple-600 mb-4" />
          <h2 className="text-4xl font-bold text-gray-900">
            {isReturningDriver ? 'Welcome back!' : 'Contact details'}
          </h2>
          {isReturningDriver && (
            <p className="text-xl text-green-600 mt-1">✓ We found your existing verification record</p>
          )}
        </div>

        <div className="space-y-6">
          {/* Progress Tracker */}
          <div className="bg-purple-50 border-2 border-purple-200 p-4 mb-6">
            <h3 className="text-2xl font-medium text-purple-900 mb-3">Verification Progress</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                  <span className="text-lg text-green-700">Verify email address</span>
                </div>
                <span className="text-sm text-green-600">Completed</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {phoneNumber ? (
                    <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                  ) : (
                    <div className="h-5 w-5 border-2 border-purple-500 rounded-full mr-3 bg-purple-100"></div>
                  )}
                  <span className={`text-lg ${phoneNumber ? 'text-green-700' : 'text-purple-700 font-medium'}`}>
                    Phone number
                  </span>
                </div>
                <span className={`text-sm ${phoneNumber ? 'text-green-600' : 'text-purple-600'}`}>
                  {phoneNumber ? 'Completed' : 'Required'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {driverStatus?.insuranceData ? (
                    <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                  ) : (
                    <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                  )}
                  <span className={`text-lg ${driverStatus?.insuranceData ? 'text-green-700' : 'text-gray-600'}`}>
                    Insurance questions
                  </span>
                </div>
                <span className={`text-sm ${driverStatus?.insuranceData ? 'text-green-600' : 'text-gray-500'}`}>
                  {driverStatus?.insuranceData ? 'Completed' : 'Required'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {driverStatus?.documents?.license?.valid ? (
                    <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                  ) : (
                    <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                  )}
                  <span className={`text-lg ${driverStatus?.documents?.license?.valid ? 'text-green-700' : 'text-gray-600'}`}>
                    Driving licence
                  </span>
                </div>
                <span className={`text-sm ${driverStatus?.documents?.license?.valid ? 'text-green-600' : 'text-gray-500'}`}>
                  {getDocumentStatus(driverStatus?.documents?.license)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {driverStatus?.documents?.poa1?.valid ? (
                    <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                  ) : (
                    <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                  )}
                  <span className={`text-lg ${driverStatus?.documents?.poa1?.valid ? 'text-green-700' : 'text-gray-600'}`}>
                    Proof of address 1
                  </span>
                </div>
                <span className={`text-sm ${driverStatus?.documents?.poa1?.valid ? 'text-green-600' : driverStatus?.documents?.poa1?.expiryDate ? 'text-orange-600' : 'text-gray-500'}`}>
                  {getDocumentStatus(driverStatus?.documents?.poa1)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {driverStatus?.documents?.poa2?.valid ? (
                    <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                  ) : (
                    <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                  )}
                  <span className={`text-lg ${driverStatus?.documents?.poa2?.valid ? 'text-green-700' : 'text-gray-600'}`}>
                    Proof of address 2
                  </span>
                </div>
                <span className={`text-sm ${driverStatus?.documents?.poa2?.valid ? 'text-green-600' : driverStatus?.documents?.poa2?.expiryDate ? 'text-orange-600' : 'text-gray-500'}`}>
                  {getDocumentStatus(driverStatus?.documents?.poa2)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {driverStatus?.documents?.dvlaCheck?.valid ? (
                    <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                  ) : (
                    <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                  )}
                  <span className={`text-lg ${driverStatus?.documents?.dvlaCheck?.valid ? 'text-green-700' : 'text-gray-600'}`}>
                    {getDocVerificationLabel(driverStatus)}
                  </span>
                </div>
                <span className={`text-sm ${driverStatus?.documents?.dvlaCheck?.valid ? 'text-green-600' : driverStatus?.documents?.dvlaCheck?.expiryDate ? 'text-orange-600' : 'text-gray-500'}`}>
                  {getDocumentStatus(driverStatus?.documents?.dvlaCheck)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                  <span className="text-lg text-gray-600">Confirmation signature</span>
                </div>
                <span className="text-sm text-gray-500">Required</span>
              </div>
            </div>
          </div>

          {/* Email (readonly) */}
          <div>
            <label className="block text-2xl font-medium text-gray-700 mb-2">
              Email address
            </label>
            <input
              type="email"
              value={driverEmail}
              readOnly
              className="w-full px-3 py-3 border border-gray-300 rounded-md bg-gray-50 text-gray-500 text-xl"
            />
          </div>

          {/* Phone Number - UNCONTROLLED COMPONENT */}
          <div>
            <label className="block text-2xl font-medium text-gray-700 mb-2">
              Phone number <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-3">
              {/* Country Code Dropdown */}
              <select
                value={countryCode}
                onChange={handleCountryChange}
                className="px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-xl bg-white"
                style={{ minWidth: '120px' }}
              >
                <option value="+44">🇬🇧 +44</option>
                <option value="+1">🇺🇸 +1</option>
                <option value="+33">🇫🇷 +33</option>
                <option value="+49">🇩🇪 +49</option>
                <option value="+34">🇪🇸 +34</option>
                <option value="+39">🇮🇹 +39</option>
                <option value="+31">🇳🇱 +31</option>
                <option value="+32">🇧🇪 +32</option>
                <option value="+41">🇨🇭 +41</option>
                <option value="+43">🇦🇹 +43</option>
                <option value="+353">🇮🇪 +353</option>
                <option value="+46">🇸🇪 +46</option>
                <option value="+47">🇳🇴 +47</option>
                <option value="+45">🇩🇰 +45</option>
                <option value="+358">🇫🇮 +358</option>
                <option value="+48">🇵🇱 +48</option>
                <option value="+351">🇵🇹 +351</option>
                <option value="+30">🇬🇷 +30</option>
                <option value="+420">🇨🇿 +420</option>
                <option value="+36">🇭🇺 +36</option>
                <option value="+61">🇦🇺 +61</option>
                <option value="+64">🇳🇿 +64</option>
                <option value="+27">🇿🇦 +27</option>
                <option value="+91">🇮🇳 +91</option>
                <option value="+86">🇨🇳 +86</option>
                <option value="+81">🇯🇵 +81</option>
                <option value="+82">🇰🇷 +82</option>
                <option value="+55">🇧🇷 +55</option>
                <option value="+52">🇲🇽 +52</option>
              </select>
              
              {/* Phone Number Input - UNCONTROLLED */}
              <input
                type="tel"
                defaultValue={phoneNumber}
                onBlur={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  setPhoneNumber(value);
                  e.target.value = value;
                }}
                className="flex-1 px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-xl"
                placeholder="123 456 7890"
                autoComplete="tel-national"
              />
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-red-400" />
                <div className="ml-3">
                  <p className="text-xl text-red-800">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-center">
            <button
              onClick={saveContactDetails}
              disabled={loading || !phoneNumber || phoneNumber.length < 9}
              className="w-full bg-purple-600 text-white py-4 px-6 rounded-md hover:bg-purple-700 disabled:opacity-50 text-xl font-medium"
            >
              {loading ? 'Saving...' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Insurance Questionnaire Component 
  const InsuranceQuestionnaire = () => {
    const [formData, setFormData] = useState({
      datePassedTest: '',
      hasDisability: null,
      hasConvictions: null,
      hasProsecution: null,
      hasAccidents: null,
      hasInsuranceIssues: null,
      hasDrivingBan: null,
      additionalDetails: ''
    });
    
    const [errors, setErrors] = useState({});
    const [datePassedTestError, setDatePassedTestError] = useState('');
    const isReturningDriver = driverStatus?.status !== 'new';

    // Pre-populate from insuranceData if available
    useEffect(() => {
      if (driverStatus?.insuranceData) {
        setFormData({
          datePassedTest: driverStatus.insuranceData.datePassedTest || '',
          hasDisability: driverStatus.insuranceData.hasDisability ? 'yes' : 'no',
          hasConvictions: driverStatus.insuranceData.hasConvictions ? 'yes' : 'no',
          hasProsecution: driverStatus.insuranceData.hasProsecution ? 'yes' : 'no',
          hasAccidents: driverStatus.insuranceData.hasAccidents ? 'yes' : 'no',
          hasInsuranceIssues: driverStatus.insuranceData.hasInsuranceIssues ? 'yes' : 'no',
          hasDrivingBan: driverStatus.insuranceData.hasDrivingBan ? 'yes' : 'no',
          additionalDetails: driverStatus.insuranceData.additionalDetails || ''
        });
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const validateDatePassedTest = (date) => {
      if (!date) {
        setDatePassedTestError('Please enter the date you passed your driving test');
        return false;
      }

      const passedDate = new Date(date);
      const today = new Date();
      
      if (isNaN(passedDate.getTime())) {
        setDatePassedTestError('Please enter a valid date');
        return false;
      }

      if (passedDate > today) {
        setDatePassedTestError('Date cannot be in the future');
        return false;
      }

      const yearsDifference = (today - passedDate) / (1000 * 60 * 60 * 24 * 365.25);
      
      if (yearsDifference < 2) {
        setDatePassedTestError(`You must have held your licence for at least 2 years. Currently: ${yearsDifference.toFixed(1)} years`);
        return false;
      }

      if (yearsDifference > 70) {
        setDatePassedTestError('Please check the date entered');
        return false;
      }

      setDatePassedTestError('');
      return true;
    };

    const handleQuestionChange = (field, value) => {
      preserveScrollPosition();
      
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
      
      if (errors[field]) {
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors[field];
          return newErrors;
        });
      }
      
      restoreScrollPosition();
    };

    const YesNoQuestion = ({ field, question, value, onChange, error }) => {
      return (
        <div className="border border-gray-200 rounded-md p-4">
          <h4 className="text-xl font-medium text-gray-900 mb-3">{question}</h4>
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => onChange(field, 'yes')}
              className={`px-6 py-3 rounded-md text-lg font-medium transition-colors ${
                value === 'yes'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => onChange(field, 'no')}
              className={`px-6 py-3 rounded-md text-lg font-medium transition-colors ${
                value === 'no'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              No
            </button>
          </div>
          {error && (
            <p className="text-lg text-red-600 mt-2">{error}</p>
          )}
        </div>
      );
    };

    const hasYesAnswers = () => {
      return ['hasDisability', 'hasConvictions', 'hasProsecution', 'hasAccidents', 'hasInsuranceIssues', 'hasDrivingBan']
        .some(field => formData[field] === 'yes');
    };

    const validateQuestions = () => {
      const newErrors = {};
      
      if (!validateDatePassedTest(formData.datePassedTest)) {
        newErrors.datePassedTest = datePassedTestError;
      }
      
      const requiredFields = [
        'hasDisability', 'hasConvictions', 'hasProsecution', 
        'hasAccidents', 'hasInsuranceIssues', 'hasDrivingBan'
      ];
      
      requiredFields.forEach(field => {
        if (formData[field] === null) {
          newErrors[field] = 'Please select an option';
        }
      });

      if (hasYesAnswers() && !formData.additionalDetails.trim()) {
        newErrors.additionalDetails = 'Please provide additional details for your "Yes" answers';
      }

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

        await handleInsuranceComplete(submissionData);
        
      } catch (error) {
        console.error('❌ Submission error:', error.message);
        setErrors({ submit: 'Failed to submit questionnaire. Please try again.' });
      }
    };

    return (
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6" ref={formContainerRef}>
        <div className="text-center mb-6">
          <FileText className="mx-auto h-12 w-12 text-purple-600 mb-4" />
          <h2 className="text-4xl font-bold text-gray-900">
            {isReturningDriver ? 'Update insurance questions' : 'Insurance questions'}
          </h2>
          {isReturningDriver && (
            <p className="text-lg text-orange-600 mt-1">Please confirm your previous answers are still correct</p>
          )}
        </div>

        <div className="space-y-6">
          {/* Progress Tracker */}
          <div className="bg-purple-50 border-2 border-purple-200 p-4 mb-6">
            <h3 className="text-2xl font-medium text-purple-900 mb-3">Verification Progress</h3>
            {!driverStatus?.documents ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-2"></div>
                <p className="text-sm text-gray-600">Loading verification status...</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                    <span className="text-lg text-green-700">Verify email address</span>
                  </div>
                  <span className="text-sm text-green-600">Completed</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                    <span className="text-lg text-green-700">Phone number</span>
                  </div>
                  <span className="text-sm text-green-600">Completed</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="h-5 w-5 border-2 border-purple-500 rounded-full mr-3 bg-purple-100"></div>
                    <span className="text-lg text-purple-700 font-medium">Insurance questions</span>
                  </div>
                  <span className="text-sm text-purple-600">In progress</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {driverStatus?.documents?.license?.valid ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                    ) : (
                      <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                    )}
                    <span className={`text-lg ${driverStatus?.documents?.license?.valid ? 'text-green-700' : 'text-gray-600'}`}>
                      Driving licence
                    </span>
                  </div>
                  <span className={`text-sm ${driverStatus?.documents?.license?.valid ? 'text-green-600' : 'text-gray-500'}`}>
                    {getDocumentStatus(driverStatus?.documents?.license)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {driverStatus?.documents?.poa1?.valid ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                    ) : (
                      <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                    )}
                    <span className={`text-lg ${driverStatus?.documents?.poa1?.valid ? 'text-green-700' : 'text-gray-600'}`}>
                      Proof of address 1
                    </span>
                  </div>
                  <span className={`text-sm ${driverStatus?.documents?.poa1?.valid ? 'text-green-600' : driverStatus?.documents?.poa1?.expiryDate ? 'text-orange-600' : 'text-gray-500'}`}>
                    {getDocumentStatus(driverStatus?.documents?.poa1)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {driverStatus?.documents?.poa2?.valid ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                    ) : (
                      <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                    )}
                    <span className={`text-lg ${driverStatus?.documents?.poa2?.valid ? 'text-green-700' : 'text-gray-600'}`}>
                      Proof of address 2
                    </span>
                  </div>
                  <span className={`text-sm ${driverStatus?.documents?.poa2?.valid ? 'text-green-600' : driverStatus?.documents?.poa2?.expiryDate ? 'text-orange-600' : 'text-gray-500'}`}>
                    {getDocumentStatus(driverStatus?.documents?.poa2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {driverStatus?.documents?.dvlaCheck?.valid ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                    ) : (
                      <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                    )}
                    <span className={`text-lg ${driverStatus?.documents?.dvlaCheck?.valid ? 'text-green-700' : 'text-gray-600'}`}>
                      {getDocVerificationLabel(driverStatus)}
                    </span>
                  </div>
                  <span className={`text-sm ${driverStatus?.documents?.dvlaCheck?.valid ? 'text-green-600' : driverStatus?.documents?.dvlaCheck?.expiryDate ? 'text-orange-600' : 'text-gray-500'}`}>
                    {getDocumentStatus(driverStatus?.documents?.dvlaCheck)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="h-5 w-5 border-2 border-gray-300 rounded-full mr-3"></div>
                    <span className="text-lg text-gray-600">Confirmation signature</span>
                  </div>
                  <span className="text-sm text-gray-500">Required</span>
                </div>
              </div>
            )}
          </div>

          {/* Date Passed Test Section */}
          <div className="border border-purple-300 rounded-md p-4 bg-purple-50">
            <h3 className="text-xl font-bold text-purple-900 mb-3">
              Date Passed Test
            </h3>
            <p className="text-base text-gray-700 mb-3">
              You must have held a full driving licence (category B) for at least 2 years.
            </p>
            
            <div className="form-group">
              <label htmlFor="datePassedTest" className="block text-lg font-medium text-gray-700 mb-2">
                Date you passed your category B driving test *
              </label>
              <input
                type="date"
                id="datePassedTest"
                name="datePassedTest"
                value={formData.datePassedTest}
                onChange={(e) => {
                  handleQuestionChange('datePassedTest', e.target.value);
                  validateDatePassedTest(e.target.value);
                }}
                onBlur={() => validateDatePassedTest(formData.datePassedTest)}
                max={new Date().toISOString().split('T')[0]}
                className={`w-full max-w-xs px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-lg ${
                  datePassedTestError ? 'border-red-500' : 'border-gray-300'
                }`}
                required
              />
              
              {datePassedTestError && (
                <div className="text-red-500 text-base mt-2">
                  ⚠️ {datePassedTestError}
                </div>
              )}
              
              {!datePassedTestError && formData.datePassedTest && (
                <div className="text-green-600 text-base mt-2">
                  ✓ Valid - held for {((new Date() - new Date(formData.datePassedTest)) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1)} years
                </div>
              )}
            </div>
            
            <p className="text-sm text-orange-600 mt-3 italic">
              ⚠️ Important: Providing false information will invalidate your insurance and may result in prosecution.
            </p>
          </div>

          {/* Insurance Questions */}
          <div className="bg-purple-50 border border-purple-200 rounded-md p-4">
            <h3 className="text-2xl font-medium text-purple-900 mb-4">Health & driving history</h3>
            <div className="space-y-4">
              <YesNoQuestion
                field="hasDisability"
                question="Have you any physical or mental disability or infirmity, or been told by your doctor not to drive, even temporarily?"
                value={formData.hasDisability}
                onChange={handleQuestionChange}
                error={errors.hasDisability}
              />
              
              <YesNoQuestion
                field="hasConvictions"
                question="Have you ever had a BA, DD, DR, UT, MS90, MS30, IN10, CU80, TT99, or CD conviction, or a single SP offence yielding 6 or more points?"
                value={formData.hasConvictions}
                onChange={handleQuestionChange}
                error={errors.hasConvictions}
              />
              
              <YesNoQuestion
                field="hasProsecution"
                question="Have you in the past 5 years been convicted of any of the following offences: manslaughter, causing death by dangerous driving, driving whilst under the influence of drink or drugs, failing to stop after and/or report an accident to police or any combination of offences that have resulted in suspension or disqualification from driving?"
                value={formData.hasProsecution}
                onChange={handleQuestionChange}
                error={errors.hasProsecution}
              />
              
              <YesNoQuestion
                field="hasAccidents"
                question="Have you been involved in any motoring accidents in the past three years?"
                value={formData.hasAccidents}
                onChange={handleQuestionChange}
                error={errors.hasAccidents}
              />
              
              <YesNoQuestion
                field="hasInsuranceIssues"
                question="Have you ever been refused motor insurance or had any special terms or premiums imposed?"
                value={formData.hasInsuranceIssues}
                onChange={handleQuestionChange}
                error={errors.hasInsuranceIssues}
              />
              
              <YesNoQuestion
                field="hasDrivingBan"
                question="Have you been banned or disqualified from driving in the past 5 years?"
                value={formData.hasDrivingBan}
                onChange={handleQuestionChange}
                error={errors.hasDrivingBan}
              />
            </div>
          </div>

          {/* Additional Details */}
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-2">
              Additional information {hasYesAnswers() && <span className="text-red-500">*</span>}
              {hasYesAnswers() && <span className="text-base text-gray-500 ml-1">(required due to "Yes" answers above)</span>}
            </label>
            <textarea
              value={formData.additionalDetails}
              onChange={(e) => {
                preserveScrollPosition();
                setFormData(prev => ({ ...prev, additionalDetails: e.target.value }));
                if (errors.additionalDetails) {
                  setErrors(prev => {
                    const newErrors = { ...prev };
                    delete newErrors.additionalDetails;
                    return newErrors;
                  });
                }
                restoreScrollPosition();
              }}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-lg"
              placeholder={hasYesAnswers() ? "Please provide details about your answers above..." : "Please provide any additional details about your answers above..."}
            />
            {errors.additionalDetails && (
              <p className="text-lg text-red-600 mt-1">{errors.additionalDetails}</p>
            )}
          </div>

          {/* Error Display */}
          {errors.submit && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-red-400" />
                <div className="ml-3">
                  <p className="text-lg text-red-800">{errors.submit}</p>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex space-x-3">
            <button
              onClick={() => handleStepChange('contact-details')}
              className="flex-1 bg-gray-200 text-gray-700 py-3 px-4 rounded-md hover:bg-gray-300 text-lg"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 text-lg"
            >
              {loading ? 'Saving...' : 'Continue to documents'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Landing page
  const renderLanding = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center mb-6">
        <img 
          src="https://www.oooshtours.co.uk/images/ooosh-tours-logo.png" 
          alt="Ooosh Tours Ltd" 
          className="mx-auto h-16 w-auto mb-4"
        />
        <h1 className="text-3xl font-bold text-gray-900">Hire agreement - proposal for insurance</h1>
      </div>
      
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-2 text-xl text-gray-600">Loading...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="text-center mb-4">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-2xl font-bold text-red-900 mb-2">Job number not found</h2>
          </div>
          
          <div className="space-y-4">
            <div className="bg-white rounded-md p-4 border border-red-200">
              <h3 className="font-medium text-red-900 mb-3">This may be because:</h3>
              <ul className="text-base text-red-800 space-y-2">
                <li className="flex items-start">
                  <span className="text-red-500 mr-2">•</span>
                  <span>The hire period has ended or been cancelled</span>
                </li>
                <li className="flex items-start">
                  <span className="text-red-500 mr-2">•</span>
                  <span>The verification link has expired</span>
                </li>
                <li className="flex items-start">
                  <span className="text-red-500 mr-2">•</span>
                  <span>The job reference number is incorrect</span>
                </li>
              </ul>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <h3 className="font-medium text-blue-900 mb-2">What to do next:</h3>
              <div className="space-y-3 text-base text-blue-800">
                <p>📞 <strong>Call us:</strong> <a href="tel:01273911382" className="text-purple-600 hover:text-purple-800 font-medium">01273 911382</a></p>
                <p>📧 <strong>Email:</strong> <a href="mailto:info@oooshtours.co.uk" className="text-purple-600 hover:text-purple-800 font-medium">info@oooshtours.co.uk</a></p>
                <p>💬 <strong>Include:</strong> Your job reference number and this error message</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-xl text-gray-600">Loading...</p>
        </div>
      )}
    </div>
  );

  // Email entry page
  const renderEmailEntry = () => (
    <div className="min-h-screen bg-gray-50">
      {/* Header with Logo */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <img 
                src="https://www.oooshtours.co.uk/images/ooosh-tours-logo.png" 
                alt="Ooosh Tours Ltd" 
                className="h-12 w-auto"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto pt-8 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          
          {/* Header Section */}
          <div className="bg-gray-50 px-6 py-8 text-center border-b">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Hire agreement - proposal for insurance
            </h1>
          </div>

          {/* Introduction Section */}
          <div className="px-6 py-6 bg-white border-b border-gray-200">
            <p className="text-lg text-gray-700 leading-relaxed">
              This form will gather your details as a proposed driver for hire <strong>{jobDetails?.jobNumber || jobId}</strong>{' '}
              {jobDetails?.startDate && jobDetails?.endDate ? (
                <>which is from <strong>{formatHireDate(jobDetails.startDate)}</strong> to <strong>{formatHireDate(jobDetails.endDate)}</strong>. Or</>
              ) : (
                <>. Or</>
              )}, if you have recently completed a form for a different hire, it will re-validate your documents.{' '}
              {!isMobile && "It's best completed on a smartphone though it can be done on a computer with camera. "}
            </p>
            <p className="text-lg text-gray-700 leading-relaxed mt-3">
              Please make sure you review our{' '}
              <a 
                href="https://www.oooshtours.co.uk/files/Ooosh_vehicle_hire_terms.pdf" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-purple-600 hover:text-purple-800 font-medium inline-flex items-center"
              >
                T&Cs here <ExternalLink className="h-4 w-4 ml-1" />
              </a>
            </p>
            
            {/* Mobile QR code */}
            {!isMobile && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-300">
                <div className="flex items-start space-x-4">
                  <Smartphone className="h-6 w-6 text-purple-600 mt-1 flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900 mb-2">📱 For best experience, use your smartphone</h4>
                    <p className="text-base text-gray-700 mb-3">
                      Scan this QR code with your phone's camera to open this page on your mobile device:
                    </p>
                    <div className="text-center">
                      <img 
                        src={generateQRCode()} 
                        alt="QR Code for mobile access" 
                        className="mx-auto border border-gray-300 rounded"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Email Entry Section */}
          <div className="px-6 py-8 bg-white border-b-4 border-purple-200">
            <div className="max-w-md mx-auto">
              <div className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-3xl font-bold text-gray-900 mb-3 text-center">
                    Enter your email address to get started
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={driverEmail}
                    onChange={(e) => setDriverEmail(e.target.value)}
                    className="w-full px-4 py-4 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-xl"
                    placeholder="driver@example.com"
                    disabled={loading}
                  />
                  <p className="text-lg text-gray-500 mt-2 text-center">We'll send a verification code to this email address</p>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex">
                      <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
                      <div className="ml-3">
                        <p className="text-lg text-red-800">{error}</p>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={sendVerificationEmail}
                  disabled={loading || !driverEmail}
                  className="w-full bg-purple-600 text-white py-4 px-6 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-xl flex items-center justify-center space-x-2"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Sending code...</span>
                    </>
                  ) : (
                    <span>Send verification code</span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Requirements Section */}
          <div className="bg-gray-50 px-6 py-6">
            <h3 className="text-2xl font-semibold text-gray-900 mb-4">What you'll need</h3>
            
            <div className="space-y-4 text-lg text-gray-700">
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">👥 All drivers:</h4>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Must be at least 23 years old</li>
                  <li>Must have held a full driving licence for at least 2 years</li>
                  <li>Must have a valid driving licence (we'll need photos of front and back)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">🆔 UK licence additional requirements:</h4>
                <ul className="list-disc ml-5 space-y-1">
                  <li>
                    Current DVLA licence check from{' '}
                    <a 
                      href="https://www.gov.uk/view-driving-licence" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-purple-600 hover:text-purple-800 underline"
                    >
                      gov.uk/view-driving-licence
                    </a>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">🌍 Non-UK licence additional requirements:</h4>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Current passport (we'll need a photo)</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">🏠 All drivers - two proofs of address:</h4>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Bank statements, utility bills, council tax, or credit card statements</li>
                  <li>Both must be dated within the last 90 days</li>
                  <li>They do not have to be physical copies - downloaded PDFs or screenshots are fine</li>
                  <li>Must show your current home address</li>
                  <li>Documents must be from two different sources</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-2">📋 Insurance questions:</h4>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Answer health and driving history questions</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between text-base text-gray-500">
                <span>Need help?</span>
                <a 
                  href="tel:01273911382" 
                  className="text-purple-600 hover:text-purple-800 inline-flex items-center text-lg"
                >
                  <Phone className="h-4 w-4 mr-1" />
                  01273 911382
                </a>
              </div>
              
              <div className="mt-2 text-base text-gray-500">
                <a 
                  href="https://www.oooshtours.co.uk/how-to-get-a-dvla-check-code" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:text-purple-800 inline-flex items-center text-lg"
                >
                  DVLA guide <ExternalLink className="h-4 w-4 ml-1" />
                </a>
                {' | '}
                <a 
                  href="https://www.oooshtours.co.uk/files/Ooosh_vehicle_hire_terms.pdf" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:text-purple-800 inline-flex items-center text-lg"
                >
                  Terms & conditions <ExternalLink className="h-4 w-4 ml-1" />
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
        <h2 className="text-3xl font-bold text-gray-900">Check your email</h2>
        <p className="text-xl text-gray-600 mt-2">We sent a 6-digit code to:</p>
        <p className="text-lg font-medium text-gray-900 break-words">{driverEmail}</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-start">
          <svg className="h-5 w-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-base text-blue-800">
            <p className="font-medium">Can't find the email?</p>
            <p className="mt-1">Check your spam/junk folder - verification emails sometimes end up there!</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="code" className="block text-lg font-medium text-gray-700 mb-1">
            Verification code
          </label>
          <input
            type="text"
            id="code"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 text-center text-2xl font-mono"
            placeholder="123456"
            maxLength="6"
            disabled={loading}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <div className="flex items-center">
              <svg className="h-4 w-4 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-lg text-red-800">{error}</p>
            </div>
          </div>
        )}

        <button
          onClick={verifyEmailCode}
          disabled={loading || verificationCode.length < 6}
          className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-lg flex items-center justify-center space-x-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Verifying...</span>
            </>
          ) : (
            <span>Verify code</span>
          )}
        </button>

        <button
          onClick={sendVerificationEmail}
          disabled={loading}
          className="w-full text-purple-600 hover:text-purple-700 text-lg disabled:opacity-50 disabled:cursor-not-allowed py-2"
        >
          {loading ? 'Please wait...' : "Didn't receive the code? Send again"}
        </button>

        <button
          onClick={startAgain}
          disabled={loading}
          className="w-full text-gray-500 hover:text-gray-700 text-base disabled:opacity-50 disabled:cursor-not-allowed py-1 border-t border-gray-200 mt-4 pt-4"
        >
          Wrong email address? Start again
        </button>
      </div>
    </div>
  );

  const renderDocumentUpload = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center mb-6">
        <Upload className="mx-auto h-12 w-12 text-purple-600 mb-4" />
        <h2 className="text-3xl font-bold text-gray-900">Document verification</h2>
        <p className="text-xl text-gray-600 mt-2">AI-powered document verification via Idenfy</p>
      </div>

      <div className="space-y-4 mb-6">
        <div className="border border-gray-200 rounded-md p-4">
          <h3 className="text-xl font-medium text-gray-900 mb-2">Required documents:</h3>
          <ul className="text-lg text-gray-600 space-y-1">
            <li>• UK driving licence (front and back)</li>
            <li>• Two proof of address documents (within 90 days)</li>
            <li>• Selfie for identity verification</li>
          </ul>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-md p-3">
          <p className="text-lg text-purple-800">
            <strong>Acceptable proof of address:</strong> Utility bills, bank statements, council tax, credit card statements
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          <p className="text-lg text-red-800">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        <button
          onClick={startVerification}
          disabled={loading}
          className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 text-lg"
        >
          {loading ? 'Starting verification...' : 'Start document upload'}
        </button>

        <button
          onClick={() => handleStepChange('insurance-questionnaire')}
          className="w-full bg-gray-200 text-gray-700 py-3 px-4 rounded-md hover:bg-gray-300 text-lg"
        >
          Back
        </button>

        <button
          onClick={startAgain}
          className="w-full text-gray-500 hover:text-gray-700 text-base py-2 border-t border-gray-200 mt-4 pt-4"
        >
          Need to use a different email? Start again
        </button>
      </div>
    </div>
  );

  const renderProcessing = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Processing verification</h2>
        <p className="text-xl text-gray-600">Please wait while we verify your documents...</p>
        <p className="text-lg text-gray-500 mt-2">This usually takes 30-60 seconds</p>
      </div>
    </div>
  );

  const renderComplete = () => (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
      <div className="text-center py-8">
        <CheckCircle className="mx-auto h-12 w-12 text-green-600 mb-4" />
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Verification complete!</h2>
        <p className="text-xl text-gray-600 mb-4">You're approved for this hire.</p>
        
        <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-6">
          <p className="text-lg text-green-800">
            Your verification has been added to the hire roster. You'll receive confirmation details shortly.
          </p>
        </div>

        <button
          onClick={() => window.close()}
          className="w-full bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 text-lg"
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
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Verification issues</h2>
        <p className="text-xl text-gray-600 mb-4">We couldn't approve your verification.</p>
        
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
          <p className="text-lg text-red-800">
            This may be due to document quality, insurance requirements, or other factors. 
            Please contact us for assistance.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={startVerification}
            className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-lg"
          >
            Try again
          </button>
          
          <a href="tel:01273911382"
            className="w-full bg-red-600 text-white py-3 px-4 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 inline-flex items-center justify-center text-lg"
          >
            <Phone className="h-4 w-4 mr-2" />
            Call us
          </a>

          <button
            onClick={startAgain}
            className="w-full text-gray-500 hover:text-gray-700 text-base py-2 border-t border-gray-200 mt-4 pt-4"
          >
            Start verification again
          </button>
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
      case 'contact-details': return <ContactDetails />;
      case 'insurance-questionnaire': return <InsuranceQuestionnaire />;
      case 'document-upload': return renderDocumentUpload();
      case 'processing-hub':
        const urlParams = new URLSearchParams(window.location.search);
        return (
          <ProcessingHub 
            driverEmail={urlParams.get('email') || driverEmail}
            jobId={urlParams.get('job') || jobId}
            sessionType={urlParams.get('sessionType') || 'full'}
          />
        );
      case 'poa-validation':
        return (
          <POAValidationPage 
            driverEmail={driverEmail}
            jobId={jobId}
          />
        );
      case 'passport-upload':
        return (
          <PassportUploadPage 
            driverEmail={driverEmail}
            jobId={jobId}
          />
        );
      case 'dvla-processing':
        return (
          <DVLAProcessingPage 
            driverEmail={driverEmail} 
            onComplete={() => handleStepChange('complete')} 
            onDVLAUpload={handleDVLAUpload}
          />
        );
      case 'processing': return renderProcessing();
      case 'signature': return <SignaturePage driverEmail={driverEmail} jobId={jobId} />;
      case 'complete': return renderComplete();
      case 'rejected': return renderRejected();
      default: return renderLanding();
    }
  };

  return (
    <>
      {/* Custom Favicon */}
      <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='12' fill='none' stroke='%236B46C1' stroke-width='4' stroke-dasharray='20 8'/%3E%3C/svg%3E" />
      
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
