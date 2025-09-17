// File: src/ProcessingHub.js
// COMPLETE VERSION with all routing fixes

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader, CheckCircle, AlertCircle, Clock, RefreshCw, Shield } from 'lucide-react';

const ProcessingHub = ({ driverEmail, jobId, sessionType }) => {
  console.log('🔍 ProcessingHub initialized:', { driverEmail, jobId, sessionType });
  
  const [status, setStatus] = useState('waiting');
  const [attempts, setAttempts] = useState(0);
  const [driverData, setDriverData] = useState(null);
  const [message, setMessage] = useState('Processing your verification...');
  const initialCheckDateRef = useRef(null);
  
  // Use refs to avoid recreating functions
  const attemptsRef = useRef(0);
  const intervalRef = useRef(null);
  
  const MAX_ATTEMPTS = 20;
  const POLL_INTERVAL = 2000;

  // Route to next step - FIXED to use correct data structure
  const routeToNextStep = useCallback((data) => {
    console.log('🧭 ROUTING DECISION START');
    console.log('📊 Full driver data:', JSON.stringify(data, null, 2));
    
    if (!data) {
      console.error('❌ No data for routing - STOPPING');
      return;
    }
    
    // Check POA validation - FIXED to use documents structure
    const poa1Date = data.documents?.poa1?.expiryDate;
    const poa2Date = data.documents?.poa2?.expiryDate;
    const poa1Valid = data.documents?.poa1?.valid;
    const poa2Valid = data.documents?.poa2?.valid;
    
    console.log('🔍 Checking POA status:', {
      poa1Date,
      poa2Date,
      poa1Valid,
      poa2Valid
    });
    
    // Check if POAs are invalid or missing
    if (!poa1Valid || !poa2Valid) {
      console.log('🚦 ROUTING TO: poa-validation (POAs invalid or missing)');
      window.location.href = `/?step=poa-validation&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      return;
    }
    
    // Check if UK driver needs DVLA
    const isUKDriver = 
      data.nationality === 'GB' || 
      data.nationality === 'United Kingdom' ||
      data.licenseIssuedBy === 'DVLA' ||
      data.licenseIssuedBy?.includes('UK') ||
      data.licenseIssuedBy?.includes('GB');
    
    console.log('🇬🇧 UK check:', { 
      isUKDriver, 
      nationality: data.nationality, 
      issuedBy: data.licenseIssuedBy 
    });
    
    if (isUKDriver) {
      // Check DVLA validity - FIXED to use documents structure
      const dvlaValid = data.documents?.dvlaCheck?.valid;
      
      console.log('📋 DVLA check status:', {
        dvlaValid,
        dvlaExpiry: data.documents?.dvlaCheck?.expiryDate,
        dvlaStatus: data.documents?.dvlaCheck?.status
      });
      
      if (!dvlaValid) {
        console.log('🚦 ROUTING TO: dvla-processing (UK driver needs DVLA check)');
        window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
        return;
      }
    } else {
      // Non-UK driver - check passport
      if (!data.passportVerified) {
        console.log('🚦 ROUTING TO: passport-upload (non-UK needs passport)');
        window.location.href = `/?step=passport-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
        return;
      }
    }
    
    // Check license verification date
    const licenseCheckValid = data.documents?.licenseCheck?.valid;
    const licenseCheckDue = data.documents?.licenseCheck?.nextCheckDue;
    
    console.log('📅 License check status:', {
      valid: licenseCheckValid,
      nextCheckDue: licenseCheckDue
    });
    
    if (licenseCheckDue && !licenseCheckValid) {
      console.log('🚦 ROUTING TO: document-upload (license check due)');
      window.location.href = `/?step=document-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      return;
    }
    
    // All checks passed - go to signature
    console.log('🚦 ROUTING TO: signature (all checks complete)');
    window.location.href = `/?step=signature&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
  }, [driverEmail, jobId]);

  // Check for webhook by monitoring idenfyCheckDate
  const checkWebhookProcessed = useCallback(async () => {
    try {
      // Use ref value for attempts
      const currentAttempt = attemptsRef.current + 1;
      attemptsRef.current = currentAttempt;
      setAttempts(currentAttempt);
      
      console.log(`🔄 Polling for webhook (attempt ${currentAttempt}/${MAX_ATTEMPTS})`);
      
      // Add cache-busting parameter to ensure fresh data
      const cacheBuster = Date.now();
      const response = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}&t=${cacheBuster}`);
      
      if (!response.ok) {
        console.log(`📊 Driver status returned: ${response.status}`);
        
        if (currentAttempt < MAX_ATTEMPTS) {
          setMessage('Waiting for verification to process...');
          // Continue polling
          intervalRef.current = setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
        } else {
          setStatus('timeout');
          setMessage('Verification is taking longer than expected');
        }
        return;
      }
      
      const data = await response.json();
      
      console.log('📊 Driver data retrieved:', {
        email: data?.email,
        idenfyCheckDate: data?.idenfyCheckDate,
        attempt: currentAttempt
      });
      
      // Check for webhook timestamp
      let webhookReceived = false;
      
      // Check if webhook timestamp exists AND is recent
      if (data?.idenfyCheckDate) {
        console.log('📅 Found idenfyCheckDate:', data.idenfyCheckDate);
        
        // Parse ISO timestamp
        try {
          const webhookTime = new Date(data.idenfyCheckDate);
          const now = new Date();
          const minutesAgo = (now - webhookTime) / (1000 * 60);
          
          console.log(`⏰ Webhook timestamp is ${minutesAgo.toFixed(1)} minutes old`);
          
          // If timestamp is recent (within 5 minutes), consider webhook received
          if (minutesAgo >= 0 && minutesAgo < 5) {
            console.log('✅ Recent webhook detected!');
            webhookReceived = true;
          } else if (minutesAgo < 0) {
            console.log('⚠️ Timestamp is in the future - possible timezone issue');
            // Still accept it if it's not too far in the future (1 minute tolerance)
            if (minutesAgo > -1) {
              webhookReceived = true;
            }
          } else {
            console.log('⏳ Timestamp too old - continuing to wait for fresh webhook');
          }
        } catch (e) {
          console.error('Failed to parse timestamp:', e);
          // Fallback: if we can't parse it but it exists, assume it's new
          if (!initialCheckDateRef.current || data.idenfyCheckDate !== initialCheckDateRef.current) {
            webhookReceived = true;
          }
        }
      }
      
      // For testing - allow override
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('forceRoute') === 'true') {
        console.log('⚠️ DEBUG: forceRoute=true, bypassing wait');
        webhookReceived = true;
      }
      
      if (webhookReceived) {
        console.log('🎉 Webhook confirmed! Waiting 1 second for all data to load...');
        setDriverData(data);
        setStatus('success');
        setMessage('Verification complete! Loading next step...');
        
        // Wait 1 second for all data to load, then route
        setTimeout(() => {
          console.log('🚀 Routing to next step...');
          routeToNextStep(data);
       }, 4000); // Changed from 1000 to 4000 to allow time for data to populate
        
      } else {
        console.log('⏳ No webhook received yet - idenfyCheckDate:', data?.idenfyCheckDate);
        
        if (currentAttempt < MAX_ATTEMPTS) {
          // Update message based on time waited
          const secondsWaited = currentAttempt * 2;
          if (secondsWaited < 10) {
            setMessage('Waiting for verification to complete...');
          } else if (secondsWaited < 20) {
            setMessage('Processing your documents...');
          } else if (secondsWaited < 30) {
            setMessage('This is taking a bit longer than usual...');
          } else {
            setMessage('Almost there, please wait...');
          }
          
          // Continue polling
          intervalRef.current = setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
          
        } else {
          console.log('⏱️ Timeout - webhook never arrived after 40 seconds');
          setStatus('timeout');
          setMessage('Verification is taking longer than expected');
        }
      }
      
    } catch (error) {
      console.error('❌ Error in webhook check:', error);
      
      const currentAttempt = attemptsRef.current;
      if (currentAttempt < MAX_ATTEMPTS) {
        intervalRef.current = setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
      } else {
        setStatus('error');
        setMessage('An error occurred while processing');
      }
    }
  }, [driverEmail, routeToNextStep, MAX_ATTEMPTS, POLL_INTERVAL]);

  const handleRetry = () => {
    console.log('🔄 Retry requested');
    setStatus('waiting');
    setAttempts(0);
    attemptsRef.current = 0;
    initialCheckDateRef.current = null; // Clear initial timestamp
    setMessage('Retrying verification check...');
    checkWebhookProcessed();
  };

  const handleManualContinue = () => {
    console.log('⏭️ Manual continue requested');
    if (driverData) {
      routeToNextStep(driverData);
    } else {
      window.location.href = `/?step=poa-validation&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
    }
  };

  // Start polling on mount
  useEffect(() => {
    console.log('🚀 ProcessingHub mounted - starting webhook poll');
    checkWebhookProcessed();
    
    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render states
  if (status === 'waiting') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <div className="relative inline-flex">
              <Loader className="h-16 w-16 text-purple-600 animate-spin" />
              <Shield className="h-8 w-8 text-purple-600 absolute top-4 left-4 animate-pulse" />
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 mt-6 mb-2">
              Verifying Your Documents
            </h2>
            
            <p className="text-gray-600 mb-6">{message}</p>
            
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-center space-x-2 text-purple-700">
                <Clock className="h-5 w-5" />
                <span className="text-sm font-medium">
                  {Math.max(0, (MAX_ATTEMPTS - attempts) * 2)} seconds remaining
                </span>
              </div>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all duration-500"
                style={{ 
                  width: `${Math.min(100, (attempts / MAX_ATTEMPTS) * 100)}%`,
                  maxWidth: '100%'
                }}
              />
            </div>
            
            <p className="text-xs text-gray-500 mt-4">
              Please don't close this window
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Verification Processed
            </h2>
            
            <p className="text-gray-600">{message}</p>
            
            <div className="mt-6">
              <Loader className="h-6 w-6 text-purple-600 animate-spin mx-auto" />
              <p className="text-sm text-gray-500 mt-2">Redirecting...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'timeout') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <AlertCircle className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Processing Delayed
            </h2>
            
            <p className="text-gray-600 mb-6">
              Your verification is taking longer than expected. This occasionally happens 
              during busy periods.
            </p>
            
            <div className="space-y-3">
              <button
                onClick={handleRetry}
                className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 
                         focus:outline-none focus:ring-2 focus:ring-purple-500 flex items-center 
                         justify-center space-x-2"
              >
                <RefreshCw className="h-5 w-5" />
                <span>Check Again</span>
              </button>
              
              <button
                onClick={handleManualContinue}
                className="w-full bg-gray-200 text-gray-700 py-3 px-4 rounded-md hover:bg-gray-300 
                         focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                Continue Anyway
              </button>
              
              <p className="text-sm text-gray-500 mt-4">
                If the problem persists, please contact support at{' '}
                <a href="tel:01273911382" className="text-purple-600 hover:text-purple-800">
                  01273 911382
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Verification Error
            </h2>
            
            <p className="text-gray-600 mb-6">{message}</p>
            
            <div className="space-y-3">
              <button
                onClick={handleRetry}
                className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 
                         focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                Try Again
              </button>
              
              <a href="tel:01273911382"
                className="w-full bg-red-600 text-white py-3 px-4 rounded-md hover:bg-red-700 
                         focus:outline-none focus:ring-2 focus:ring-red-500 inline-flex items-center 
                         justify-center"
              >
                Call Support
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default ProcessingHub;
