import express from 'express';
import {
  handleCDataGet,
  handleCDataPost,
  handleGetRequest,
  handleDeviceCmd,
  handlePing,
  simulatePush
} from '../controllers/admsController.js';

const router = express.Router();

// 1. Handshake & initialization endpoints
router.get('/cdata', handleCDataGet);

// 2. Attendance log & event upload endpoints
router.post('/cdata', handleCDataPost);
router.post('/push', handleCDataPost);

// 3. Command polling & confirmation endpoints
router.all('/getrequest', handleGetRequest);
router.all('/devicecmd', handleDeviceCmd);

// 4. Biometric template, photo & registry endpoints
router.all('/fdata', handlePing);
router.all('/registry', handlePing);
router.all('/ping', handlePing);

// 5. Built-in Simulator API for developers and dashboard demo
router.post('/simulate', simulatePush);

export default router;
