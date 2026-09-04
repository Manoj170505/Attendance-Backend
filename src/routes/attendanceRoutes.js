import express from 'express';
import {
  getAttendanceLogs,
  getAttendanceStats,
  getLatestPunchTimestamp,
  recordPunch,
  syncDeviceUsers,
  downloadAgentScript
} from '../controllers/attendanceController.js';

const router = express.Router();

router.get('/logs', getAttendanceLogs);
router.get('/stats', getAttendanceStats);
router.get('/latest-timestamp', getLatestPunchTimestamp);
router.get('/download-agent', downloadAgentScript);
router.post('/punch', recordPunch);
router.post('/sync-users', syncDeviceUsers);

export default router;

