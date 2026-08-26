import express from 'express';
import {
  handleCDataGet,
  handleCDataPost,
  handleGetRequest,
  handleDeviceCmd,
  simulatePush
} from '../controllers/admsController.js';

const router = express.Router();

// BioMax / eSSL ADMS standard push endpoints
router.get('/cdata', handleCDataGet);
router.post('/cdata', handleCDataPost);
router.get('/getrequest', handleGetRequest);
router.post('/devicecmd', handleDeviceCmd);

// Simulator API for developers and dashboard demo
router.post('/simulate', simulatePush);

export default router;
