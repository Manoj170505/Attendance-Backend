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

// Enable CORS for frontend dashboard
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-company-id', 'x-serial-number']
}));

// Logger middleware
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// BioMax / eSSL ADMS devices send plain text, form-urlencoded or octet-stream data.
// We configure body parsers to handle all possible formats:
app.use(express.text({ type: ['text/plain', 'text/html', 'application/octet-stream', 'application/x-www-form-urlencoded'], limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'BioMax / eSSL Multi-Tenant Cloud Attendance Engine'
  });
});

// ADMS Protocol Routes
// BioMax & eSSL firmware devices connect to:
// 1. /iclock/cdata and /iclock/getrequest
// 2. /cdata and /getrequest
// 3. /api/adms/*
app.use('/iclock', admsRoutes);
app.use('/cdata', (req, res, next) => {
  req.url = '/cdata' + (req.url === '/' ? '' : req.url);
  admsRoutes(req, res, next);
});
app.use('/api/adms', admsRoutes);

// Dashboard REST APIs
app.use('/api/companies', companyRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);

// 404 handler for unexpected routes
app.use((req, res) => {
  // If it's a device ping, return 'OK' so biometric device doesn't hang
  if (req.path.includes('iclock') || req.path.includes('cdata')) {
    res.set('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  }
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.url} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 BioMax/eSSL ADMS Attendance Server running on port ${PORT}`);
  console.log(`📡 ADMS Endpoint: http://localhost:${PORT}/iclock/cdata`);
  console.log(`📊 Dashboard API: http://localhost:${PORT}/api/attendance/logs`);
  console.log('====================================================');
});

export default app;
