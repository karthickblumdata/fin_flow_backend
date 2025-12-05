const express = require('express');
const router = express.Router();
const { protect, authorize, authorizeByPermission } = require('../middleware/authMiddleware');
const {
  getActionButtonSettings,
  updateActionButtonSettings,
  resetActionButtonSettings
} = require('../controllers/settingsController');

// Settings routes - SuperAdmin OR roles with settings.manage permission
router.get('/action-buttons', protect, authorizeByPermission('settings.manage', ['SuperAdmin']), getActionButtonSettings);
router.put('/action-buttons', protect, authorizeByPermission('settings.manage', ['SuperAdmin']), updateActionButtonSettings);
router.post('/action-buttons/reset', protect, authorizeByPermission('settings.manage', ['SuperAdmin']), resetActionButtonSettings);

module.exports = router;


