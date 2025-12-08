const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { protect, authorize, authorizeByPermission, authorizeByAnyPermission } = require('../middleware/authMiddleware');
const {
  createExpense,
  getExpenses,
  approveExpense,
  rejectExpense,
  unapproveExpense,
  flagExpense,
  resubmitExpense,
  updateExpense,
  deleteExpense,
  uploadExpenseProofImage,
} = require('../controllers/expenseController');
const { getExpenseSummary } = require('../controllers/reportController');

// Configure multer for expense proof image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/expenses');
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
    
    cb(null, 'expense-proof-' + uniqueSuffix + extension);
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

router.post('/', protect, createExpense);
router.get('/', protect, getExpenses);
router.get('/summary', protect, getExpenseSummary);
router.post('/upload-image', protect, upload.single('image'), uploadExpenseProofImage);
// Expense management routes - Admin/SuperAdmin OR roles with expenses.manage OR wallet.all.expenses.edit permission
router.put('/:id', protect, authorizeByAnyPermission(['expenses.manage', 'wallet.all.expenses.edit'], ['Admin', 'SuperAdmin']), updateExpense);
router.post('/:id/approve', protect, approveExpense); // Allow receiver to approve if created by SuperAdmin
router.post('/:id/reject', protect, rejectExpense); // Allow receiver to reject if created by SuperAdmin
router.post('/:id/unapprove', protect, authorizeByAnyPermission(['expenses.manage', 'wallet.all.expenses.approve'], ['Admin', 'SuperAdmin']), unapproveExpense); // Allow Admin/SuperAdmin to unapprove
// Flag expense - SuperAdmin OR roles with expenses.flag OR wallet.all.expenses.flag permission
router.post('/:id/flag', protect, authorizeByAnyPermission(['expenses.flag', 'wallet.all.expenses.flag'], ['SuperAdmin']), flagExpense);
router.post('/:id/resubmit', protect, resubmitExpense); // Allow owner or Admin/SuperAdmin to resubmit
router.delete('/:id', protect, authorizeByAnyPermission(['expenses.manage', 'wallet.all.expenses.delete'], ['SuperAdmin']), deleteExpense);

module.exports = router;
