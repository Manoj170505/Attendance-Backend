import express from 'express';
import {
  getAttendanceLogs,
  getAttendanceStats,
  recordPunch,
  syncDeviceUsers
} from '../controllers/attendanceController.js';

const router = express.Router();

router.get('/logs', getAttendanceLogs);
router.get('/stats', getAttendanceStats);
router.post('/punch', recordPunch);
router.post('/sync-users', syncDeviceUsers);

export default router;
