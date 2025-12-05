const express = require('express');
const router = express.Router();
const { protect, authorize, authorizeByPermission } = require('../middleware/authMiddleware');
const {
  getAuditLogs,
  getRecentActivity,
  getUserActivity
} = require('../controllers/auditLogController');

// Audit log routes - SuperAdmin OR roles with audit_logs.view permission
router.get('/', protect, authorizeByPermission('audit_logs.view', ['SuperAdmin']), getAuditLogs);
router.get('/recent', protect, authorizeByPermission('audit_logs.view', ['SuperAdmin']), getRecentActivity);
router.get('/user/:userId', protect, authorizeByPermission('audit_logs.view', ['SuperAdmin']), getUserActivity);

module.exports = router;

