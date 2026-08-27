import express from 'express';
import {
  handleCDataGet,
  handleCDataPost,
  handleGetRequest,
  handleDeviceCmd,
  simulatePush
} from '../controllers/admsController.js';

const router = express.Router();

// BioMax / eSSL / ZKTeco ADMS standard push endpoints
router.get('/cdata', handleCDataGet);
router.post('/cdata', handleCDataPost);
router.all('/getrequest', handleGetRequest);
router.all('/devicecmd', handleDeviceCmd);
router.all('/fdata', handleCDataGet);
router.all('/registry', handleCDataGet);
router.all('/push', handleCDataPost);
router.all('/ping', handleCDataGet);

// Simulator API for developers and dashboard demo
router.post('/simulate', simulatePush);

export default router;
