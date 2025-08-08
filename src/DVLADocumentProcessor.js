import React, { useState } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, Camera } from 'lucide-react';

const DVLADocumentProcessor = () => {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [conversionLog, setConversionLog] = useState([]);

  // Add log entry for debugging
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setConversionLog(prev => [...prev, { timestamp, message, type }]);
    console.log(`[${timestamp}] ${message}`);
  };

  // Convert PDF to image using PDF.js
  const convertPdfToImage = async (file) => {
    addLog('Starting PDF conversion...', 'info');
    
    try {
      // Load PDF.js from CDN
      if (!window.pdfjsLib) {
        addLog('Loading PDF.js library...', 'info');
        await loadPdfJs();
      }

      addLog('Reading PDF file...', 'info');
      const arrayBuffer = await file.arrayBuffer();
      
      addLog('Loading PDF document...', 'info');
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      addLog(`PDF loaded: ${pdf.numPages} pages`, 'success');
      
      // Get first page (DVLA checks are usually single page)
      const page = await pdf.getPage(1);
      
      // Set up canvas with high DPI for better OCR
      const scale = 2.0; // High resolution for OCR
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      addLog(`Rendering PDF page: ${canvas.width}x${canvas.height}`, 'info');
      
      // Render PDF page to canvas
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
      addLog('PDF rendered to canvas successfully', 'success');
      
      // Convert canvas to base64 image
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
      const base64Data = imageDataUrl.split(',')[1];
      
      addLog(`Image conversion complete: ${Math.round(base64Data.length / 1024)}KB`, 'success');
      
      return {
        success: true,
        base64Data: base64Data,
        originalFormat: 'pdf',
        convertedFormat: 'jpeg',
        dimensions: { width: canvas.width, height: canvas.height }
      };
      
    } catch (error) {
      addLog(`PDF conversion failed: ${error.message}`, 'error');
      throw new Error(`PDF conversion failed: ${error.message}`);
    }
  };

  // Load PDF.js library from CDN
  const loadPdfJs = () => {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        // Set worker path
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        addLog('PDF.js loaded successfully', 'success');
        resolve();
      };
      script.onerror = () => {
        addLog('Failed to load PDF.js library', 'error');
        reject(new Error('Failed to load PDF.js library'));
      };
      document.head.appendChild(script);
    });
  };

  // Convert image file to base64
  const convertImageToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64Data = reader.result.split(',')[1];
        addLog(`Image converted: ${Math.round(base64Data.length / 1024)}KB`, 'success');
        resolve({
          success: true,
          base64Data: base64Data,
          originalFormat: file.type.split('/')[1],
          convertedFormat: file.type.split('/')[1]
        });
      };
      reader.onerror = () => {
        addLog('Failed to read image file', 'error');
        reject(new Error('Failed to read image file'));
      };
      reader.readAsDataURL(file);
    });
  };

  // Main processing function
  const processDocument = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setProcessing(true);
    setError('');
    setResult(null);
    setConversionLog([]);

    try {
      addLog(`Processing file: ${file.name} (${file.type})`, 'info');
      
      let conversionResult;
      
      // Handle PDF vs Image
      if (file.type === 'application/pdf') {
        addLog('PDF detected - converting to image for AWS Textract', 'info');
        conversionResult = await convertPdfToImage(file);
      } else if (file.type.startsWith('image/')) {
        addLog('Image detected - converting to base64', 'info');
        conversionResult = await convertImageToBase64(file);
      } else {
        throw new Error(`Unsupported file type: ${file.type}`);
      }

      addLog('Sending to AWS Textract for OCR processing...', 'info');
      
      // Call your existing AWS Textract function
      const response = await fetch('/.netlify/functions/test-claude-ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          testType: 'dvla',
          imageData: conversionResult.base64Data,
          fileType: 'image', // Always send as image to AWS
          originalFileType: file.type,
          conversionApplied: conversionResult.originalFormat === 'pdf'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const ocrResult = await response.json();
      addLog('AWS Textract processing completed', 'success');
      
      // Combine conversion info with OCR results
      const finalResult = {
        ...ocrResult,
        conversionInfo: conversionResult,
        processingMethod: conversionResult.originalFormat === 'pdf' ? 'PDF→Image→AWS Textract' : 'Image→AWS Textract'
      };

      setResult(finalResult);
      addLog('Document processing completed successfully!', 'success');
      
    } catch (error) {
      console.error('Processing error:', error);
      setError(error.message);
      addLog(`Processing failed: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
      setResult(null);
      setConversionLog([]);
      
      // Validate file
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (selectedFile.size > maxSize) {
        setError('File too large. Maximum size: 10MB');
        return;
      }
      
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'];
      if (!allowedTypes.includes(selectedFile.type)) {
        setError('Invalid file type. Please upload PDF, JPEG, PNG, or TIFF files.');
        return;
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="text-center mb-6">
        <FileText className="mx-auto h-12 w-12 text-blue-600 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900">DVLA Document Processor</h2>
        <p className="text-gray-600 mt-2">Upload DVLA check (PDF or image) for OCR processing</p>
      </div>

      {/* File Upload */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Upload DVLA Document
        </label>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
          <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
          <input
            type="file"
            onChange={handleFileChange}
            accept=".pdf,.jpg,.jpeg,.png,.tiff"
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium"
          >
            Choose file
          </label>
          <p className="text-gray-500 text-sm mt-1">PDF, JPEG, PNG, or TIFF (max 10MB)</p>
        </div>
        
        {file && (
          <div className="mt-3 p-3 bg-gray-50 rounded border">
            <p className="text-sm text-gray-700">
              <strong>Selected:</strong> {file.name} ({Math.round(file.size / 1024)}KB)
            </p>
            <p className="text-xs text-gray-500">Type: {file.type}</p>
          </div>
        )}
      </div>

      {/* Process Button */}
      <button
        onClick={processDocument}
        disabled={!file || processing}
        className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
      >
        {processing ? (
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            Processing Document...
          </div>
        ) : (
          <div className="flex items-center justify-center">
            <Camera className="h-4 w-4 mr-2" />
            Process with AWS Textract
          </div>
        )}
      </button>

      {/* Error Display */}
      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div className="ml-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Conversion Log */}
      {conversionLog.length > 0 && (
        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-md p-4">
          <h4 className="font-medium text-gray-900 mb-2">Processing Log:</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {conversionLog.map((log, index) => (
              <div key={index} className="text-xs flex items-center">
                <span className="text-gray-500 w-16">{log.timestamp}</span>
                <span className={`ml-2 ${
                  log.type === 'success' ? 'text-green-600' : 
                  log.type === 'error' ? 'text-red-600' : 'text-gray-600'
                }`}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results Display */}
      {result && (
        <div className="mt-6 bg-green-50 border border-green-200 rounded-md p-6">
          <div className="flex items-center mb-4">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <h3 className="ml-2 font-medium text-green-900">Processing Complete!</h3>
          </div>
          
          {/* Processing Method */}
          <div className="mb-4 p-3 bg-white rounded border">
            <p className="text-sm font-medium text-gray-700">Processing Method:</p>
            <p className="text-sm text-gray-600">{result.processingMethod}</p>
            {result.conversionInfo?.originalFormat === 'pdf' && (
              <p className="text-xs text-blue-600 mt-1">
                ✅ PDF successfully converted to {result.conversionInfo.convertedFormat.toUpperCase()} for AWS Textract
              </p>
            )}
          </div>

          {/* DVLA Data */}
          {result.result && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3 bg-white rounded border">
                  <p className="text-sm font-medium text-gray-700">License Number:</p>
                  <p className="text-lg font-mono">{result.result.licenseNumber || 'Not found'}</p>
                </div>
                <div className="p-3 bg-white rounded border">
                  <p className="text-sm font-medium text-gray-700">Driver Name:</p>
                  <p className="text-lg">{result.result.driverName || 'Not found'}</p>
                </div>
                <div className="p-3 bg-white rounded border">
                  <p className="text-sm font-medium text-gray-700">Total Points:</p>
                  <p className="text-lg font-bold text-red-600">{result.result.totalPoints || 0}</p>
                </div>
                <div className="p-3 bg-white rounded border">
                  <p className="text-sm font-medium text-gray-700">Check Code:</p>
                  <p className="text-lg font-mono">{result.result.checkCode || 'Not found'}</p>
                </div>
              </div>

              {/* Insurance Decision */}
              {result.result.insuranceDecision && (
                <div className={`p-4 rounded border ${
                  result.result.insuranceDecision.approved ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                }`}>
                  <h4 className="font-medium mb-2">Insurance Decision:</h4>
                  <p className={`text-lg font-bold ${
                    result.result.insuranceDecision.approved ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {result.result.insuranceDecision.approved ? '✅ APPROVED' : '❌ REQUIRES REVIEW'}
                  </p>
                  {result.result.insuranceDecision.excess > 0 && (
                    <p className="text-sm text-orange-600 mt-1">
                      Excess required: £{result.result.insuranceDecision.excess}
                    </p>
                  )}
                  <div className="mt-2">
                    {result.result.insuranceDecision.reasons.map((reason, index) => (
                      <p key={index} className="text-sm text-gray-600">• {reason}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Raw JSON Toggle */}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-700">
              Show Raw Processing Data
            </summary>
            <pre className="mt-2 p-3 bg-gray-100 rounded text-xs overflow-auto max-h-64">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Usage Instructions */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-md p-4">
        <h4 className="font-medium text-blue-900 mb-2">How it works:</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>PDF files:</strong> Automatically converted to high-resolution images using PDF.js</li>
          <li>• <strong>Image files:</strong> Processed directly with AWS Textract</li>
          <li>• <strong>OCR extraction:</strong> License number, points, endorsements, and insurance decisions</li>
          <li>• <strong>No server dependencies:</strong> All conversion happens in your browser</li>
        </ul>
      </div>
    </div>
  );
};

export default DVLADocumentProcessor;
