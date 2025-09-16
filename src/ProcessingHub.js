// File: src/ProcessingHub.js
// FIXED: Infinite loop issue and webhook detection

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader, CheckCircle, AlertCircle, Clock, RefreshCw, Shield } from 'lucide-react';

const ProcessingHub = ({ driverEmail, jobId, sessionType }) => {
  console.log('🔍 ProcessingHub initialized:', { driverEmail, jobId, sessionType });
  
  const [status, setStatus] = useState('waiting');
  const [attempts, setAttempts] = useState(0);
  const [driverData, setDriverData] = useState(null);
  const [initialData, setInitialData] = useState(null);
  const [message, setMessage] = useState('Processing your verification...');
  
  // Use refs to avoid recreating functions
  const attemptsRef = useRef(0);
  const intervalRef = useRef(null);
  
  const MAX_ATTEMPTS = 20;
  const POLL_INTERVAL = 2000;

  // Route to next step
  const routeToNextStep = useCallback((data) => {
    console.log('🧭 Routing based on webhook data:', data);
    
    if (!data) {
      console.error('❌ No data for routing');
      return;
    }
    
    // Check POA validation
    if (!data.poa1ValidUntil || !data.poa2ValidUntil) {
      console.log('→ Missing POA validity dates - routing to POA validation');
      window.location.href = `/?step=poa-validation&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      return;
    }
    
    // Check if POAs are expired
    const now = new Date();
    const poa1Valid = new Date(data.poa1ValidUntil) > now;
    const poa2Valid = new Date(data.poa2ValidUntil) > now;
    
    if (!poa1Valid || !poa2Valid) {
      console.log('→ POAs expired - routing to POA validation');
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
    
    console.log('🇬🇧 UK Driver check:', { isUKDriver, nationality: data.nationality, issuedBy: data.licenseIssuedBy });
    
    if (isUKDriver) {
      if (!data.dvlaCheckComplete || data.dvlaCheckStatus !== 'valid') {
        console.log('→ UK driver needs DVLA check');
        window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
        return;
      }
    } else {
      if (!data.passportVerified) {
        console.log('→ Non-UK driver needs passport upload');
        window.location.href = `/?step=passport-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
        return;
      }
    }
    
    console.log('→ All verifications complete - routing to signature');
    window.location.href = `/?step=signature&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
  }, [driverEmail, jobId]);

  // Check for webhook - now stable without recreating
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
        lastUpdated: data?.lastUpdated,
        hasUrls: !!(data?.licenseFrontUrl || data?.poa1Url),
        status: data?.status,
        attempt: currentAttempt,
        allFields: Object.keys(data || {})
      });
      
      // Store initial data on first check
      if (currentAttempt === 1 && !initialData) {
        setInitialData(data);
        console.log('📸 Stored initial driver state for comparison:', data);
      }
      
      // SIMPLE DETECTION: Check if ANY field changed from initial state
      let webhookJustProcessed = false;
      
      if (initialData && currentAttempt > 1) {
        console.log('🔍 Comparing data - Attempt', currentAttempt);
        console.log('Initial data:', initialData);
        console.log('Current data:', data);
        
        // Check ACTUAL Monday.com Board A column IDs for changes
        const fieldsToCheck = [
          // Board A column IDs from Monday.com
          'text_mktry2je',    // Driver Name
          'email_mktrgzj',    // Email Address
          'text_mktrfqe2',    // Phone Number
          'date_mktr2x01',    // Date of Birth
          'text_mktrdh72',    // Nationality
          'text_mktrrv38',    // License Number
          'text_mktrz69',     // License Issued By
          'date_mktr93jq',    // Date Passed Test
          'date_mktrmdx5',    // License Valid From
          'date_mktrwk94',    // License Valid To
          'text_mktr8kvs',    // License Ending
          'long_text_mktr2jhb', // Home Address
          'long_text_mktrs5a0', // License Address
          'date_mktr1keg',    // POA1 Valid Until
          'date_mktra1a6',    // POA2 Valid Until
          'date_mktrmjfr',    // DVLA Check Date
          'file_mktrypb7',    // License Front Image
          'file_mktr76g6',    // License Back Image
          'file_mktr56t0',    // Passport
          'file_mktrf9jv',    // POA Document 1
          'file_mktr3fdw',    // POA Document 2
          'file_mktrwhn8',    // DVLA Check Document
          'file_mktrfanc',    // Signature File
          'color_mktrwatg',   // Overall Status
          'date_mktrk8kv',    // Last Updated
          'color_mktrywv1',   // Verification Source
          'date4'             // Created Date
        ];
        
        // Check if any field changed
        for (const field of fieldsToCheck) {
          if (data[field] !== undefined && initialData[field] !== undefined) {
            if (data[field] !== initialData[field]) {
              console.log(`✅ Field changed: ${field} - from "${initialData[field]}" to "${data[field]}"`);
              webhookJustProcessed = true;
              break;
            } else {
              console.log(`   Field unchanged: ${field} = "${data[field]}"`);
            }
          }
        }
        
        // Also check ALL fields (not just our list)
        if (!webhookJustProcessed) {
          for (const field in data) {
            if (initialData[field] !== data[field]) {
              console.log(`✅ Unlisted field changed: ${field} - from "${initialData[field]}" to "${data[field]}"`);
              webhookJustProcessed = true;
              break;
            }
          }
        }
        
        if (webhookJustProcessed) {
          console.log('🎯 Change detected - webhook has processed!');
        } else {
          console.log('❌ No changes detected in any fields');
        }
      } else {
        console.log('⏳ Skipping comparison - Initial:', !!initialData, 'Attempt:', currentAttempt);
      }
      
      // For testing - allow override
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('forceRoute') === 'true') {
        console.log('⚠️ DEBUG: forceRoute=true, bypassing wait');
        webhookJustProcessed = true;
      }
      
      if (webhookJustProcessed) {
        console.log('🎉 Webhook confirmed! Waiting 1 second for all data to load...');
        setDriverData(data);
        setStatus('success');
        setMessage('Verification complete! Loading next step...');
        
        // Wait 1 second for all data to load, then route
        setTimeout(() => {
          console.log('🚀 Routing to next step...');
          routeToNextStep(data);
        }, 1000);
        
      } else {
        console.log('⏳ No fresh webhook detected - continuing to wait');
        
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
  }, [driverEmail, routeToNextStep, initialData, MAX_ATTEMPTS, POLL_INTERVAL]); // Fixed deps

  const handleRetry = () => {
    console.log('🔄 Retry requested');
    setStatus('waiting');
    setAttempts(0);
    attemptsRef.current = 0;
    setInitialData(null); // Clear initial data for fresh comparison
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
            
            {/* Progress bar - FIXED: added max-width */}
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
