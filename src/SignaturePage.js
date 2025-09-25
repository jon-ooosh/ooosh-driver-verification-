// File: src/SignaturePage.js
// Final signature confirmation page for driver verification

import React, { useState, useEffect, useRef } from 'react';
import { 
  CheckCircle, AlertCircle, Loader, RefreshCw, 
  FileText, User, Calendar, Car, Shield, Mail, Check, X
} from 'lucide-react';

const SignaturePage = ({ driverEmail: propEmail, jobId: propJobId }) => {
  // Support both props and URL params for testing
  const urlParams = new URLSearchParams(window.location.search);
  const driverEmail = propEmail || urlParams.get('email');
  const jobId = propJobId || urlParams.get('job');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [driverData, setDriverData] = useState(null);
  const [jobDetails, setJobDetails] = useState(null);
  const [signature, setSignature] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const minDrawingLength = useRef(0);
