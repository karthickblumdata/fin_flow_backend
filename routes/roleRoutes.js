const express = require('express');
const router = express.Router();
const { protect, authorize, authorizeByPermission } = require('../middleware/authMiddleware');
const {
  createRole,
  getRolePermissions,
  updateRolePermissions,
  getAllRoles
} = require('../controllers/roleController');

// Role management routes - SuperAdmin OR roles with all_users.roles permission
router.post('/create', protect, authorizeByPermission('all_users.roles.create', ['SuperAdmin']), createRole);

// Get all roles - SuperAdmin OR roles with all_users.roles.view permission
router.get('/', protect, authorizeByPermission('all_users.roles.view', ['SuperAdmin']), getAllRoles);

// Get role permissions - SuperAdmin OR roles with all_users.roles.view permission
router.get('/:roleName/permissions', protect, authorizeByPermission('all_users.roles.view', ['SuperAdmin']), getRolePermissions);

// Update role permissions - SuperAdmin OR roles with all_users.roles.edit permission
router.put('/:roleName/permissions', protect, authorizeByPermission('all_users.roles.edit', ['SuperAdmin']), updateRolePermissions);

module.exports = router;

