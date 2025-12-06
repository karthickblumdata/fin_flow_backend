const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { protect, authorize, authorizeByPermission } = require('../middleware/authMiddleware');
const {
  createExpenseType,
  getExpenseTypes,
  updateExpenseType,
  deleteExpenseType,
  uploadExpenseTypeImage
} = require('../controllers/expenseTypeController');

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/expense-types');
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
    
    cb(null, 'expense-type-' + uniqueSuffix + extension);
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
    // This handles cases where web uploads might not have proper extensions
    if (isValidMimeType || hasValidExtension) {
      return cb(null, true);
    } else {
      cb(new Error(`Only image files are allowed! Received: ${file.mimetype}, filename: ${file.originalname}`));
    }
  }
});

// Expense type routes - SuperAdmin OR roles with expenses.expenses_type.create/edit/delete permissions
// Note: Using 'expenses.expenses_type.create' to match frontend permission structure
// The middleware will also accept parent permission 'expenses.expenses_type' or 'expenses'
router.post('/', protect, authorizeByPermission('expenses.expenses_type.create', ['SuperAdmin']), createExpenseType);
router.get('/', protect, getExpenseTypes);
router.put('/:id', protect, authorizeByPermission('expenses.expenses_type.edit', ['SuperAdmin']), updateExpenseType);
router.delete('/:id', protect, authorizeByPermission('expenses.expenses_type.delete', ['SuperAdmin']), deleteExpenseType);
router.post('/upload-image', protect, authorizeByPermission('expenses.expenses_type.create', ['SuperAdmin']), upload.single('image'), uploadExpenseTypeImage);

module.exports = router;

