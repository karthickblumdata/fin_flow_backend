const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { protect, authorize, authorizeByPermission, authorizeByAnyPermission } = require('../middleware/authMiddleware');
const { 
  createUser, 
  getUsers, 
  updateUser, 
  deleteUser, 
  sendInvite,
  getUserPermissions,
  updateUserPermissions,
  uploadUserProfileImage
} = require('../controllers/userController');

// Configure multer for user profile image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/users');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    let extension = path.extname(file.originalname);
    
    // If no extension, try to determine from MIME type
    if (!extension) {
      const mimeToExt = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp'
      };
      extension = mimeToExt[file.mimetype.toLowerCase()] || '.jpg';
    }
    
    cb(null, 'user-profile-' + uniqueSuffix + extension);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check MIME type first (more reliable)
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const isValidMimeType = allowedMimeTypes.includes(file.mimetype.toLowerCase());
    
    // Check file extension as fallback
    const allowedExtensions = /\.(jpeg|jpg|png|gif|webp)$/i;
    const hasValidExtension = allowedExtensions.test(file.originalname);
    
    // Accept if either MIME type or extension is valid
    if (isValidMimeType || hasValidExtension) {
      return cb(null, true);
    } else {
      cb(new Error(`Only image files are allowed! Received: ${file.mimetype}, filename: ${file.originalname}`));
    }
  }
});

// User management routes - SuperAdmin OR roles with all_users.user_management permission
router.post('/create', protect, authorizeByPermission('all_users.user_management.create', ['SuperAdmin']), createUser);
router.post('/send-invite', protect, authorizeByPermission('all_users.user_management.create', ['SuperAdmin']), sendInvite);
router.post('/upload-image', protect, authorizeByPermission('all_users.user_management.edit', ['SuperAdmin']), upload.single('image'), uploadUserProfileImage);
// Allow SuperAdmin OR users with all_users.user_management OR wallet.all permission (wallet.all needed for transactions)
// This allows roles with wallet permissions to view users for transaction purposes
router.get('/', protect, authorizeByAnyPermission(['all_users.user_management', 'wallet.all'], ['SuperAdmin']), getUsers);
// Permissions routes must come before /:id route to avoid conflicts
router.get('/:id/permissions', protect, authorizeByPermission('all_users.user_management', ['SuperAdmin']), getUserPermissions);
router.put('/:id/permissions', protect, authorizeByPermission('all_users.user_management.edit', ['SuperAdmin']), updateUserPermissions);
router.put('/:id', protect, authorizeByPermission('all_users.user_management.edit', ['SuperAdmin']), updateUser);
router.delete('/:id', protect, authorizeByPermission('all_users.user_management.delete', ['SuperAdmin']), deleteUser);

module.exports = router;
