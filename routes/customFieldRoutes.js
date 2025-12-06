const express = require('express');
const router = express.Router();
const { protect, authorizeByPermission } = require('../middleware/authMiddleware');
const {
  createCustomField,
  getCustomFields,
  updateCustomField,
  deleteCustomField
} = require('../controllers/customFieldController');

// Custom field routes - SuperAdmin OR roles with settings.manage permission
// Since custom fields are under Settings menu, using settings.manage permission
router.post('/', protect, authorizeByPermission('settings.manage', ['SuperAdmin']), createCustomField);
router.get('/', protect, getCustomFields);
router.put('/:id', protect, authorizeByPermission('settings.manage', ['SuperAdmin']), updateCustomField);
router.delete('/:id', protect, authorizeByPermission('settings.manage', ['SuperAdmin']), deleteCustomField);

module.exports = router;

