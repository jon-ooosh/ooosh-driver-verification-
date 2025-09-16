// File: src/ProcessingHub.js
// Central processing hub that waits for Idenfy webhook and routes appropriately

import React, { useState, useEffect, useCallback } from 'react';
import { Loader, CheckCircle, AlertCircle, Clock, RefreshCw, Shield } from 'lucide-react';

const ProcessingHub = ({ driverEmail, jobId, sessionType }) => {
  console.log('🔍 ProcessingHub props received:', { driverEmail, jobId, sessionType });
  
  const [status, setStatus] = useState('waiting'); // waiting, success, timeout, error
  const [attempts, setAttempts] = useState(0);
  const [driverData, setDriverData] = useState(null);
  const [initialDriverState, setInitialDriverState] = useState(null); // Store initial state
  const [message, setMessage] = useState('Processing your verification...');
  
  const MAX_ATTEMPTS = 20; // 20 attempts * 2 seconds = 40 seconds max
  const POLL_INTERVAL = 2000; // 2 seconds

  // Define routeToNextStep FIRST, wrapped in useCallback
  const routeToNextStep = useCallback((data) => {
    console.log('🧭 Determining next step based on driver data:', data);
    
    // Priority routing logic
    
    // 1. Check if POA validation is needed
    if (!data.poa1ValidUntil || !data.poa2ValidUntil) {
      console.log('→ Routing to POA validation (missing validity dates)');
      window.location.href = `/?step=poa-validation&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      return;
    }
    
    // Check if POAs are still valid
    const now = new Date();
    const poa1Valid = data.poa1ValidUntil && new Date(data.poa1ValidUntil) > now;
    const poa2Valid = data.poa2ValidUntil && new Date(data.poa2ValidUntil) > now;
    
    if (!poa1Valid || !poa2Valid) {
      console.log('→ POAs expired, routing to POA validation');
      window.location.href = `/?step=poa-validation&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
      return;
    }
    
    // 2. Determine if UK or Non-UK driver
    const isUKDriver = 
      data.nationality === 'GB' || 
      data.nationality === 'UK' ||
      data.nationality === 'United Kingdom' ||
      data.licenseIssuedBy === 'DVLA' ||
      data.licenseIssuedBy?.includes('UK') ||
      data.licenseIssuedBy?.includes('GB');
    
    if (isUKDriver) {
      // 3a. UK Driver - check if DVLA check is complete
      if (!data.dvlaCheckComplete || data.dvlaCheckStatus !== 'valid') {
        console.log('→ UK driver, routing to DVLA check');
        window.location.href = `/?step=dvla-processing&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
        return;
      }
    } else {
      // 3b. Non-UK Driver - check if passport is verified
      if (!data.passportVerified) {
        console.log('→ Non-UK driver, routing to passport upload');
        window.location.href = `/?step=passport-upload&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
        return;
      }
    }
    
    // 4. All checks complete - go to signature
    console.log('→ All verifications complete, routing to signature');
    window.location.href = `/?step=signature&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
  }, [driverEmail, jobId]);

  // Check webhook processed with proper detection
  const checkWebhookProcessed = useCallback(async () => {
    try {
      console.log(`🔄 Checking webhook status (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
      
      const response = await fetch(`/.netlify/functions/driver-status?email=${encodeURIComponent(driverEmail)}`);
      console.log('📊 Response status:', response.status);
      
      if (!response.ok) {
        if (response.status === 400 || response.status === 404) {
          console.log('⚠️ Driver not found - unexpected after email verification');
          
          if (attempts < MAX_ATTEMPTS - 1) {
            setAttempts(prev => prev + 1);
            setMessage('Waiting for verification to process...');
            setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
            return;
          } else {
            setStatus('timeout');
            setMessage('Verification is taking longer than expected');
            return;
          }
        }
        
        throw new Error(`Unexpected response: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('📊 Current driver data:', data);
      
      // On first attempt, store initial state
      if (attempts === 0) {
        setInitialDriverState(data);
        console.log('📸 Stored initial driver state');
      }
      
      // WEBHOOK DETECTION STRATEGY
      let webhookProcessed = false;
      
      // Strategy 1: Check if lastUpdated changed to today
      if (data.lastUpdated) {
        const today = new Date().toISOString().split('T')[0];
        const lastUpdated = data.lastUpdated.split('T')[0]; // Handle both date and datetime
        
        if (lastUpdated === today) {
          // Check if this is a new update (not from previous verification)
          if (!initialDriverState?.lastUpdated || initialDriverState.lastUpdated !== data.lastUpdated) {
            console.log('✅ Webhook detected - lastUpdated is today and changed');
            webhookProcessed = true;
          }
        }
      }
      
      // Strategy 2: Check for NEW validity dates (webhook sets these)
      if (!webhookProcessed) {
        const hasNewValidityDates = (
          (data.poa1ValidUntil && !initialDriverState?.poa1ValidUntil) ||
          (data.poa2ValidUntil && !initialDriverState?.poa2ValidUntil) ||
          (data.dvlaValidUntil && !initialDriverState?.dvlaValidUntil) ||
          (data.licenseNextCheckDue && !initialDriverState?.licenseNextCheckDue)
        );
        
        if (hasNewValidityDates) {
          console.log('✅ Webhook detected - new validity dates found');
          webhookProcessed = true;
        }
      }
      
      // Strategy 3: Check for document URLs (webhook uploads these)
      if (!webhookProcessed) {
        const hasNewDocuments = (
          (data.licenseFrontUrl && !initialDriverState?.licenseFrontUrl) ||
          (data.licenseBackUrl && !initialDriverState?.licenseBackUrl) ||
          (data.selfieUrl && !initialDriverState?.selfieUrl) ||
          (data.poa1Url && !initialDriverState?.poa1Url) ||
          (data.poa2Url && !initialDriverState?.poa2Url)
        );
        
        if (hasNewDocuments) {
          console.log('✅ Webhook detected - new document URLs found');
          webhookProcessed = true;
        }
      }
      
      // Strategy 4: Check for Idenfy-specific data updates
      if (!webhookProcessed) {
        const hasNewIdenfyData = (
          (data.licenseNumber && !initialDriverState?.licenseNumber) ||
          (data.licenseValidTo && !initialDriverState?.licenseValidTo) ||
          (data.nationality && !initialDriverState?.nationality) ||
          (data.licenseIssuedBy && !initialDriverState?.licenseIssuedBy)
        );
        
        if (hasNewIdenfyData) {
          console.log('✅ Webhook detected - new Idenfy data found');
          webhookProcessed = true;
        }
      }
      
      // Strategy 5: Session-specific checks
      if (!webhookProcessed && sessionType === 'poa_reupload') {
        // Check for POA re-upload specific fields
        if (data.poaRevalidationDate || data.newPoaDocument || data.poaSourceValidation) {
          console.log('✅ POA re-upload webhook detected');
          webhookProcessed = true;
        }
      }
      
      if (webhookProcessed) {
        console.log('🎉 Webhook processed successfully!');
        setDriverData(data);
        setStatus('success');
        setMessage('Verification complete! Routing to next step...');
        
        // Wait briefly to show success message
        setTimeout(() => {
          routeToNextStep(data);
        }, 1500);
        
      } else if (attempts < MAX_ATTEMPTS - 1) {
        // Continue polling
        setAttempts(prev => prev + 1);
        
        // Update message based on wait time
        if (attempts === 0) {
          setMessage('Processing your verification...');
        } else if (attempts > 5) {
          setMessage('Still processing... This sometimes takes a moment...');
        } else if (attempts > 10) {
          setMessage('Taking a bit longer than usual, please wait...');
        } else if (attempts > 15) {
          setMessage('Almost there, just a few more seconds...');
        }
        
        setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
        
      } else {
        // Timeout reached
        console.log('⏱️ Timeout waiting for webhook');
        setStatus('timeout');
        setMessage('Verification is taking longer than expected');
      }
      
    } catch (error) {
      console.error('❌ Error checking webhook status:', error);
      
      if (attempts >= MAX_ATTEMPTS - 1) {
        setStatus('error');
        setMessage('An error occurred while processing your verification');
      } else {
        setAttempts(prev => prev + 1);
        setTimeout(() => checkWebhookProcessed(), POLL_INTERVAL);
      }
    }
  }, [attempts, driverEmail, sessionType, routeToNextStep, initialDriverState, MAX_ATTEMPTS, POLL_INTERVAL]);

  const handleRetry = () => {
    setStatus('waiting');
    setAttempts(0);
    setInitialDriverState(null);
    setMessage('Retrying verification check...');
    checkWebhookProcessed();
  };

  const handleManualContinue = () => {
    if (driverData) {
      routeToNextStep(driverData);
    } else {
      window.location.href = `/?step=poa-validation&email=${encodeURIComponent(driverEmail)}&job=${jobId}`;
    }
  };

  useEffect(() => {
    // Start checking for webhook on component mount
    checkWebhookProcessed();
  }, [checkWebhookProcessed]);

  // Render different states
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
            
            {/* Progress indicator */}
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
