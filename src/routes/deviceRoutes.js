import express from 'express';
import {
  getDevices,
  registerDevice,
  updateDevice,
  deleteDevice
} from '../controllers/deviceController.js';

const router = express.Router();

router.get('/', getDevices);
router.post('/', registerDevice);
router.put('/:id', updateDevice);
router.delete('/:id', deleteDevice);

export default router;
