import React, { useState } from 'react';
import { Upload, XCircle, Loader, BookOpen } from 'lucide-react';

const PassportUploadPage = ({ driverEmail, jobId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('pending');

  const triggerPassportVerification = async () => {
    setLoading(true);
    setError('');
    
    try {
      console.log('🛂 Starting passport verification for:', driverEmail);
      
      // Create Idenfy session for passport-only verification
      const response = await fetch('/.netlify/functions/create-idenfy-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: driverEmail,
          jobId: jobId,
          verificationType: 'passport_only',
          isUKDriver: false
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create passport verification session');
      }
      
      const data = await response.json();
      console.log('✅ Passport session created:', data);
      
      // Redirect to Idenfy for passport upload
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        throw new Error('No redirect URL provided');
      }
      
    } catch (err) {
      console.error('❌ Passport verification error:', err);
      setError(err.message || 'Failed to start passport verification');
      setUploadStatus('error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <Loader className="h-12 w-12 text-purple-600 animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Preparing Passport Verification
          </h2>
          <p className="text-gray-600">
            Setting up secure document upload...
          </p>
        </div>
      </div>
    );
  }

  if (uploadStatus === 'error') {
    return (
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-center">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Verification Error
          </h2>
          <p className="text-gray-600 mb-6">{error}</p>
          
          <div className="space-y-3">
            <button
              onClick={triggerPassportVerification}
              className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700"
            >
              Try Again
            </button>
            
            <button
              onClick={() => window.location.href = `/?step=contact-support&email=${encodeURIComponent(driverEmail)}`}
              className="w-full bg-gray-200 text-gray-700 py-3 px-4 rounded-md hover:bg-gray-300"
            >
              Contact Support
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
      <div className="text-center mb-6">
        <BookOpen className="h-12 w-12 text-purple-600 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Passport Verification Required
        </h2>
        <p className="text-gray-600">
          As a non-UK driver, we need to verify your passport
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-blue-900 mb-2">What you'll need:</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Your current valid passport</li>
          <li>• Good lighting for photo capture</li>
          <li>• A few minutes to complete verification</li>
        </ul>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-purple-800">
          <strong>Note:</strong> Your address verification has already been completed. 
          This final step confirms your identity for international driving.
        </p>
      </div>

      <button
        onClick={triggerPassportVerification}
        disabled={loading}
        className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
      >
        <Upload className="h-5 w-5" />
        <span>Start Passport Upload</span>
      </button>

      <p className="text-xs text-gray-500 text-center mt-4">
        Secure verification powered by Idenfy
      </p>
    </div>
  );
};

export default PassportUploadPage;
