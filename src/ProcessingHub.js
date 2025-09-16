// File: src/ProcessingHub.js
// Central processing hub that waits for Idenfy webhook and routes appropriately
// FIXED: Syntax error corrected - missing closing parenthesis for useCallback

import React, { useState, useEffect, useCallback } from 'react';
import { Loader, CheckCircle, AlertCircle, Clock, RefreshCw, Shield } from 'lucide-react';

const ProcessingHub = ({ driverEmail, jobId, sessionType }) => {
  console.log('🔍 ProcessingHub initialized:', { driverEmail, jobId, sessionType });
  
  const [status, setStatus] = useState('waiting');
  const [attempts, setAttempts] = useState(0);
  const [driverData, setDriverData] = useState(null);
  const [message, setMessage] = useState('Processing your verification...');
  const [loadTime] = useState(Date.now()); // Track when component loaded
  
  const MAX_ATTEMPTS = 20; // 20 attempts * 2 seconds = 40 seconds max
  const POLL_INTERVAL = 2000; // 2 seconds

  // Route to next step - but ONLY after webhook confirmed
  const routeToNextStep = useCallback((data) => {
    console.log('🧭 Routing based on webhook data:', data);
    
    // Safety check - don't route without data
    if (!data) {
      console.error('❌ No data for routing');
      return;
    }
    
    // Routing logic based on webhook data
    // 1. Check POA validation
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
    
    // 2. Check if UK driver needs DVLA
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
      // 3. Non-UK driver needs passport?
      if (!data.passportVerified) {
        console.log('→ Non-UK driver needs passport upload');
        window.location.href = `/?step=passport-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
        return;
      }
    }
    
    // 4. All complete - signature
    console.log('→ All verifications complete - routing to signature');
    window.location.href = `/?step=signature&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
  }, [driverEmail, jobId]);

  // Check for webhook - STRICT checking for NEW data only
  const checkWebhookProcessed = useCallback(async () => {
    try {
      console.log(`🔄 Polling for webhook (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
      
      const response = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
      
      // Handle response
      if (!response.ok) {
        console.log(`📊 Driver status returned: ${response.status}`);
        
        // Keep polling regardless of status
        if (attempts < MAX_ATTEMPTS - 1) {
          setAttempts(prev => prev + 1);
          setMessage('Waiting for verification to process...');
          setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
        } else {
          setStatus('timeout');
          setMessage('Verification is taking longer than expected');
        }
        return;
      }
      
      const data = await response.json();
      
      // Log what we found
      console.log('📊 Driver data retrieved:', {
        email: data?.email,
        lastUpdated: data?.lastUpdated,
        hasUrls: !!(data?.licenseFrontUrl || data?.poa1Url),
        status: data?.status
      });
      
      // CRITICAL: Detect if webhook has JUST processed
      let webhookJustProcessed = false;
      
      // Strategy 1: Check if lastUpdated is VERY recent
      if (data?.lastUpdated) {
        // Parse the date (handle both date-only and datetime formats)
        const lastUpdateStr = data.lastUpdated;
        let lastUpdateTime;
        
        // If it's just a date (YYYY-MM-DD), it was updated today
        if (lastUpdateStr.length === 10) {
          // Date only - check if it's today
          const today = new Date().toISOString().split('T')[0];
          if (lastUpdateStr === today) {
            // Updated today - but we need to know if it's RECENT
            console.log('📅 lastUpdated is today (date only)');
            
            // Check for other fresh indicators
            if (data.licenseFrontUrl || data.poa1Url || data.licenseNumber) {
              // Has data that webhook would set
              const millisSinceLoad = Date.now() - loadTime;
              const secondsSinceLoad = millisSinceLoad / 1000;
              
              // If we've been polling less than 30 seconds and data exists, assume it's new
              if (secondsSinceLoad < 30) {
                console.log(`✅ Data present and we started polling ${secondsSinceLoad.toFixed(1)}s ago - assuming webhook processed`);
                webhookJustProcessed = true;
              }
            }
          }
        } else {
          // Has datetime - can check precisely
          lastUpdateTime = new Date(lastUpdateStr);
          const now = new Date();
          const secondsAgo = (now - lastUpdateTime) / 1000;
          
          // Webhook processed if updated in last 30 seconds
          if (secondsAgo < 30) {
            console.log(`✅ Webhook detected - updated ${secondsAgo.toFixed(1)}s ago`);
            webhookJustProcessed = true;
          } else {
            console.log(`⏳ Last update was ${secondsAgo.toFixed(1)}s ago - too old, still waiting`);
          }
        }
      }
      
      // Strategy 2: For testing - check URL param override
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('forceRoute') === 'true') {
        console.log('⚠️ DEBUG: forceRoute=true, bypassing wait');
        webhookJustProcessed = true;
      }
      
      // Decision point
      if (webhookJustProcessed) {
        console.log('🎉 Webhook confirmed! Processing route...');
        setDriverData(data);
        setStatus('success');
        setMessage('Verification complete! Routing to next step...');
        
        // Small delay then route
        setTimeout(() => {
          routeToNextStep(data);
        }, 1500);
        
      } else {
        // No webhook yet - KEEP WAITING
        console.log('⏳ No fresh webhook detected - continuing to wait');
        
        if (attempts < MAX_ATTEMPTS - 1) {
          setAttempts(prev => prev + 1);
          
          // Update message based on time waited
          const secondsWaited = attempts * 2;
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
          setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
          
        } else {
          // Max attempts reached
          console.log('⏱️ Timeout - webhook never arrived after 40 seconds');
          setStatus('timeout');
          setMessage('Verification is taking longer than expected');
        }
      }
      
    } catch (error) {
      console.error('❌ Error in webhook check:', error);
      
      // On error, keep trying unless out of attempts
      if (attempts < MAX_ATTEMPTS - 1) {
        setAttempts(prev => prev + 1);
        setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
      } else {
        setStatus('error');
        setMessage('An error occurred while processing');
      }
    }
  }, [attempts, driverEmail, routeToNextStep, loadTime, MAX_ATTEMPTS, POLL_INTERVAL]); // FIXED: Added closing parenthesis here

  const handleRetry = () => {
    console.log('🔄 Retry requested');
    setStatus('waiting');
    setAttempts(0);
    setMessage('Retrying verification check...');
    checkWebhookProcessed();
  };

  const handleManualContinue = () => {
    console.log('⏭️ Manual continue requested');
    if (driverData) {
      routeToNextStep(driverData);
    } else {
      // Default to POA validation if no data
      window.location.href = `/?step=poa-validation&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
    }
  };

  // Start polling on mount
  useEffect(() => {
    console.log('🚀 ProcessingHub mounted - starting webhook poll');
    checkWebhookProcessed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run once on mount

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
            
            {/* Progress bar */}
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${(attempts / MAX_ATTEMPTS) * 100}%` }}
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
