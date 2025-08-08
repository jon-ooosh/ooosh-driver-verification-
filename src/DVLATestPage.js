import React from 'react';
import DVLADocumentProcessor from './DVLADocumentProcessor';

const DVLATestPage = () => {
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">DVLA Document Processing Test</h1>
          <p className="text-gray-600">Test PDF→Image conversion + AWS Textract OCR</p>
        </div>
        
        <DVLADocumentProcessor />
        
        {/* Test Instructions */}
        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h3 className="font-medium text-yellow-900 mb-3">🧪 Test Instructions</h3>
          <div className="text-sm text-yellow-800 space-y-2">
            <p><strong>Test with DVLA PDF:</strong></p>
            <ul className="list-disc ml-5 space-y-1">
              <li>Go to <a href="https://gov.uk/check-driving-licence" className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">gov.uk/check-driving-licence</a></li>
              <li>Enter license details and generate check</li>
              <li>Download/save as PDF</li>
              <li>Upload here to test PDF→Image→OCR workflow</li>
            </ul>
            <p className="mt-3"><strong>Expected results:</strong> License number, points, endorsements, insurance decision</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DVLATestPage;
