const ExpenseType = require('../models/expenseTypeModel');
const Expense = require('../models/expenseModel');
const { createAuditLog } = require('../utils/auditLogger');
const { emitExpenseTypeUpdate } = require('../utils/socketService');

// @desc    Create expense type
// @route   POST /api/expense-types
// @access  Private (Admin, SuperAdmin)
exports.createExpenseType = async (req, res) => {
  try {
    const { name, description, isActive, imageUrl, proofRequired } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please provide expense type name'
      });
    }

    // Check if expense type with same name already exists (check all types, not just active)
    const existingType = await ExpenseType.findOne({ 
      name: name.trim()
    });

    if (existingType) {
      return res.status(400).json({
        success: false,
        message: 'Expense type with this name already exists'
      });
    }

    const expenseType = await ExpenseType.create({
      name: name.trim(),
      description: description || '',
      isActive: isActive !== undefined ? isActive : true,
      imageUrl: imageUrl || '',
      proofRequired: proofRequired !== undefined ? proofRequired : false,
      createdBy: req.user._id
    });

    await createAuditLog(
      req.user._id,
      `Created expense type: ${expenseType.name}`,
      'Create',
      'ExpenseType',
      expenseType._id,
      null,
      expenseType.toObject(),
      req.ip
    );

    // Get unapproved expense count for the new type
    const expenseCount = await Expense.countDocuments({ 
      category: expenseType.name,
      status: { $nin: ['Approved', 'approved'] }
    });

    const expenseTypeWithCount = {
      ...expenseType.toObject(),
      expenseCount
    };

    // Emit real-time update
    emitExpenseTypeUpdate('created', expenseTypeWithCount);

    res.status(201).json({
      success: true,
      message: 'Expense type created successfully',
      expenseType: expenseTypeWithCount
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Expense type with this name already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create expense type'
    });
  }
};

// @desc    Get expense types
// @route   GET /api/expense-types
// @access  Private
exports.getExpenseTypes = async (req, res) => {
  try {
    const { isActive } = req.query;
    const query = {};
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const expenseTypes = await ExpenseType.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    // Get unapproved expense count for each type
    const expenseTypesWithCount = await Promise.all(
      expenseTypes.map(async (type) => {
        // Count only unapproved expenses (status is not 'Approved' or 'approved')
        const expenseCount = await Expense.countDocuments({ 
          category: type.name,
          status: { $nin: ['Approved', 'approved'] }
        });
        return {
          ...type.toObject(),
          expenseCount
        };
      })
    );

    res.status(200).json({
      success: true,
      count: expenseTypesWithCount.length,
      expenseTypes: expenseTypesWithCount
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get expense types'
    });
  }
};

// @desc    Update expense type
// @route   PUT /api/expense-types/:id
// @access  Private (Admin, SuperAdmin)
exports.updateExpenseType = async (req, res) => {
  try {
    const expenseType = await ExpenseType.findById(req.params.id);

    if (!expenseType) {
      return res.status(404).json({
        success: false,
        message: 'Expense type not found'
      });
    }

    const previousValue = expenseType.toObject();
    const { name, description, isActive, imageUrl, proofRequired } = req.body;

    // Check if name is being changed and if new name already exists (check all types, not just active)
    if (name && name.trim() !== expenseType.name) {
      const existingType = await ExpenseType.findOne({ 
        name: name.trim(),
        _id: { $ne: expenseType._id }
      });

      if (existingType) {
        return res.status(400).json({
          success: false,
          message: 'Expense type with this name already exists'
        });
      }
      expenseType.name = name.trim();
    }

    if (description !== undefined) expenseType.description = description;
    if (isActive !== undefined) expenseType.isActive = isActive;
    if (imageUrl !== undefined) expenseType.imageUrl = imageUrl;
    // Explicitly handle proofRequired - accept both true and false values
    // Check if proofRequired is in the request body (even if false)
    if (req.body.hasOwnProperty('proofRequired')) {
      expenseType.proofRequired = Boolean(proofRequired);
    }

    await expenseType.save();

    await createAuditLog(
      req.user._id,
      `Updated expense type: ${expenseType.name}`,
      'Update',
      'ExpenseType',
      expenseType._id,
      previousValue,
      expenseType.toObject(),
      req.ip
    );

    // Get unapproved expense count
    const expenseCount = await Expense.countDocuments({ 
      category: expenseType.name,
      status: { $nin: ['Approved', 'approved'] }
    });

    const expenseTypeWithCount = {
      ...expenseType.toObject(),
      expenseCount
    };

    // Emit real-time update
    emitExpenseTypeUpdate('updated', expenseTypeWithCount);

    res.status(200).json({
      success: true,
      message: 'Expense type updated successfully',
      expenseType: expenseTypeWithCount
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Expense type with this name already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update expense type'
    });
  }
};

// @desc    Delete expense type
// @route   DELETE /api/expense-types/:id
// @access  Private (Admin, SuperAdmin)
exports.deleteExpenseType = async (req, res) => {
  try {
    const expenseType = await ExpenseType.findById(req.params.id);

    if (!expenseType) {
      return res.status(404).json({
        success: false,
        message: 'Expense type not found'
      });
    }

    // Check if there are any expenses using this type
    const expenseCount = await Expense.countDocuments({ 
      category: expenseType.name 
    });

    // If expenses exist, deactivate instead of deleting
    if (expenseCount > 0) {
      const previousValue = expenseType.toObject();
      expenseType.isActive = false;
      await expenseType.save();

      await createAuditLog(
        req.user._id,
        `Deactivated expense type: ${expenseType.name} (${expenseCount} expense(s) using this type)`,
        'Update',
        'ExpenseType',
        expenseType._id,
        previousValue,
        expenseType.toObject(),
        req.ip
      );

      // Get unapproved expense count
      const unapprovedCount = await Expense.countDocuments({ 
        category: expenseType.name,
        status: { $nin: ['Approved', 'approved'] }
      });

      const expenseTypeWithCount = {
        ...expenseType.toObject(),
        expenseCount: unapprovedCount
      };

      // Emit real-time update
      emitExpenseTypeUpdate('updated', expenseTypeWithCount);

      return res.status(200).json({
        success: true,
        message: `Expense type deactivated successfully. There are ${expenseCount} expense(s) using this type.`,
        expenseType: expenseTypeWithCount,
        deactivated: true
      });
    }

    // No expenses using this type, safe to delete
    const previousValue = expenseType.toObject();
    await expenseType.deleteOne();

    await createAuditLog(
      req.user._id,
      `Deleted expense type: ${expenseType.name}`,
      'Delete',
      'ExpenseType',
      expenseType._id,
      previousValue,
      null,
      req.ip
    );

    // Emit real-time update
    emitExpenseTypeUpdate('deleted', {
      _id: expenseType._id,
      id: expenseType._id,
      name: expenseType.name
    });

    res.status(200).json({
      success: true,
      message: 'Expense type deleted successfully',
      deactivated: false
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete expense type'
    });
  }
};

// @desc    Upload expense type image
// @route   POST /api/expense-types/upload-image
// @access  Private (Admin, SuperAdmin)
exports.uploadExpenseTypeImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    // Construct the image URL
    // Adjust this based on your server setup
    const baseUrl = req.protocol + '://' + req.get('host');
    const imageUrl = `${baseUrl}/uploads/expense-types/${req.file.filename}`;

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl: imageUrl
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload image'
    });
  }
};

