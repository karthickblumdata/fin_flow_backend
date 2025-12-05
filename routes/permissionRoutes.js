const express = require('express');
const router = express.Router();
const {
  createPermission,
  getAllPermissions,
  getPermissionById,
  updatePermission,
  deletePermission
} = require('../controllers/permissionController');
const { protect, authorize, authorizeByPermission } = require('../middleware/authMiddleware');

// All routes are protected - SuperAdmin OR roles with permissions.manage permission
router.use(protect);
router.use(authorizeByPermission('permissions.manage', ['SuperAdmin']));

router.route('/')
  .get(getAllPermissions)
  .post(createPermission);

router.route('/:id')
  .get(getPermissionById)
  .put(updatePermission)
  .delete(deletePermission);

module.exports = router;

