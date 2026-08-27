import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';

import admsRoutes from './routes/admsRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';
import employeeRoutes from './routes/employeeRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend dashboard and external API clients
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-company-id', 'x-serial-number', 'sn', 'x-forwarded-for']
}));

// Morgan HTTP request logging (standard Apache combined in prod, colorized dev in local)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Universal Body Parsers:
// BioMax, eSSL, and ZKTeco ADMS devices transmit data with varying Content-Types
// (text/plain, application/octet-stream, application/x-www-form-urlencoded, or missing Content-Type headers).
// We enable text parser for all text/binary device streams, while retaining JSON and urlencoded for REST APIs.
app.use(express.text({
  type: ['text/*', 'application/octet-stream', 'application/x-www-form-urlencoded'],
  limit: '25mb'
}));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.json({ limit: '25mb' }));

// Health check endpoint for Railway, AWS, and uptime monitoring
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'BioMax / eSSL / ZKTeco Multi-Tenant ADMS Cloud Engine',
    port: PORT,
    environment: process.env.NODE_ENV || 'development'
  });
});

// ADMS Protocol Routes:
// Biometric firmware communicates via:
// 1. /iclock/* (Standard default for BioMax & eSSL)
// 2. /api/adms/* (Proxy/Gateway standard)
app.use('/iclock', admsRoutes);
app.use('/api/adms', admsRoutes);

// Root-level aliases for devices with non-standard base paths (e.g. /cdata, /getrequest, /fdata, /push, /ping)
app.use(['/cdata', '/getrequest', '/devicecmd', '/fdata', '/registry', '/push', '/ping'], (req, res, next) => {
  const originalPath = req.baseUrl || req.path;
  req.url = originalPath + (req.url === '/' ? '' : req.url);
  admsRoutes(req, res, next);
});

// Dashboard REST APIs
app.use('/api/companies', companyRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);

// Catch-all 404 handler
app.use((req, res) => {
  // If it's a device handshake or log ping, always reply 'OK' so the hardware does not hang
  if (req.path.includes('iclock') || req.path.includes('cdata') || req.path.includes('getrequest')) {
    console.log(`[ADMS 404 Intercept] Fallback 'OK' returned for path: ${req.method} ${req.originalUrl}`);
    res.set('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server Fatal Error]', err);
  if (req.path.includes('iclock') || req.path.includes('cdata')) {
    res.set('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(`🚀 BioMax / eSSL / ZKTeco ADMS Cloud Server running on port ${PORT}`);
  console.log(`📡 ADMS Handshake Endpoint: /iclock/cdata`);
  console.log(`📡 ADMS Polling Endpoint:   /iclock/getrequest`);
  console.log(`📊 Dashboard Health Check:  /health`);
  console.log(`📊 Dashboard API:           /api/attendance/logs`);
  console.log('================================================================');
});

export default app;
