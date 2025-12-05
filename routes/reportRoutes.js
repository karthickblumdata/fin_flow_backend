const express = require('express');
const router = express.Router();
const { protect, authorize, authorizeByPermission } = require('../middleware/authMiddleware');
const { 
  getReports, 
  getPersonWiseReports,
  saveReport,
  getSavedReports,
  getSavedReport,
  updateSavedReport,
  deleteSavedReport,
  duplicateSavedReport,
  getReportTemplates
} = require('../controllers/reportController');

// Report routes - SuperAdmin OR roles with reports permission
router.get('/', protect, authorizeByPermission('reports.view', ['SuperAdmin']), getReports);
router.get('/person-wise', protect, authorizeByPermission('reports.view', ['SuperAdmin']), getPersonWiseReports);
router.post('/save', protect, authorizeByPermission('reports.manage', ['SuperAdmin']), saveReport);
router.get('/saved', protect, authorizeByPermission('reports.view', ['SuperAdmin']), getSavedReports);
router.get('/saved/:id', protect, authorizeByPermission('reports.view', ['SuperAdmin']), getSavedReport);
router.put('/saved/:id', protect, authorizeByPermission('reports.manage', ['SuperAdmin']), updateSavedReport);
router.delete('/saved/:id', protect, authorizeByPermission('reports.manage', ['SuperAdmin']), deleteSavedReport);
router.post('/saved/:id/duplicate', protect, authorizeByPermission('reports.manage', ['SuperAdmin']), duplicateSavedReport);
router.get('/templates', protect, authorizeByPermission('reports.view', ['SuperAdmin']), getReportTemplates);

module.exports = router;
