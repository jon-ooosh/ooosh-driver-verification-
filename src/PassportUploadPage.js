// File: src/PassportUploadPage.js
// Passport upload page for non-UK drivers after POA validation

import React, { useState } from 'react';
import { Upload, Loader, CheckCircle, AlertCircle, BookOpen } from 'lucide-react';

const PassportUploadPage = ({ driverEmail, jobId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const startPassportUpload = async () => {
    try {
      setLoading(true);
      setError('');
      console.log('🛂 Starting passport upload session for:', driverEmail);

      // Create Idenfy session for passport upload only
      const response = await fetch('/.netlify/functions/idenfy-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: driverEmail,
          jobId: jobId,
          sessionType: 'passport-only',
          documentType: 'PASSPORT',
          clientId: `${jobId}_${driverEmail}_PASSPORT_${Date.now()}`
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create passport upload session');
      }

      const data = await response.json();
      
      if (data.sessionToken) {
        console.log('✅ Passport session created, redirecting to Idenfy');
        // Redirect to Idenfy for passport upload
        window.location.href = data.redirectUrl || 
          `https://ui.idenfy.com/session?authToken=${data.sessionToken}&documentType=PASSPORT`;
      } else {
        throw new Error('No session token received');
      }

    } catch (err) {
      console.error('Error creating passport session:', err);
      setError('Failed to start passport upload. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
      <div className="text-center">
        <BookOpen className="h-16 w-16 text-purple-600 mx-auto mb-4" />
        
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Passport Verification Required
        </h2>
        
        <p className="text-gray-600 mb-6">
          As an international driver, we need to verify your passport to complete your registration.
        </p>

        <div className="bg-blue-50 rounded-lg p-4 mb-6 text-left">
          <h3 className="font-semibold text-blue-900 mb-2">What you'll need:</h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li className="flex items-start">
              <CheckCircle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
              <span>Valid passport (not expired)</span>
            </li>
            <li className="flex items-start">
              <CheckCircle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
              <span>Clear photo of the main ID page</span>
            </li>
            <li className="flex items-start">
              <CheckCircle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
              <span>Good lighting and no glare</span>
            </li>
          </ul>
        </div>

        {error && (
          <div className="bg-red-50 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          onClick={startPassportUpload}
          disabled={loading}
          className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        >
          {loading ? (
            <>
              <Loader className="h-5 w-5 animate-spin mr-2" />
              Preparing Upload...
            </>
          ) : (
            <>
              <Upload className="h-5 w-5 mr-2" />
              Upload Passport
            </>
          )}
        </button>

        <p className="text-sm text-gray-500 mt-4">
          This typically takes 2-3 minutes to complete
        </p>
      </div>
    </div>
  );
};

export default PassportUploadPage;
