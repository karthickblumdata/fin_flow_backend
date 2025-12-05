const express = require('express');
const router = express.Router();
const { protect, authorize, authorizeByPermission, authorizeByAnyPermission } = require('../middleware/authMiddleware');
const {
  createCollection,
  getCollections,
  approveCollection,
  rejectCollection,
  flagCollection,
  resubmitCollection,
  editCollection,
  restoreCollection,
  deleteCollection,
} = require('../controllers/collectionController');

router.post('/', protect, createCollection); // Allow any authenticated user to create collection
router.get('/', protect, getCollections);
router.put('/:id', protect, editCollection); // Allow creator or SuperAdmin to edit
router.post('/:id/approve', protect, approveCollection); // Allow receiver to approve if created by SuperAdmin
router.post('/:id/reject', protect, rejectCollection); // Allow receiver to reject if created by SuperAdmin
// Collection management routes - SuperAdmin OR roles with collections.flag OR wallet.all.collection.flag permission
router.post('/:id/flag', protect, authorizeByAnyPermission(['collections.flag', 'wallet.all.collection.flag'], ['SuperAdmin']), flagCollection);
router.post('/:id/resubmit', protect, resubmitCollection); // Allow owner or Admin/SuperAdmin to resubmit
router.post('/:id/restore', protect, authorizeByAnyPermission(['collections.manage', 'wallet.all.collection.approve'], ['SuperAdmin']), restoreCollection);
router.delete('/:id', protect, authorizeByAnyPermission(['collections.manage', 'wallet.all.collection.remove'], ['SuperAdmin']), deleteCollection);

module.exports = router;
