const CustomField = require('../models/customFieldModel');
const { createAuditLog } = require('../utils/auditLogger');

// @desc    Create custom field
// @route   POST /api/collection-custom-fields
// @access  Private (Admin, SuperAdmin)
exports.createCustomField = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please provide custom field name'
      });
    }

    // Check if custom field with same name already exists
    const existingField = await CustomField.findOne({ 
      name: name.trim()
    });

    if (existingField) {
      return res.status(400).json({
        success: false,
        message: 'Custom field with this name already exists'
      });
    }

    const customField = await CustomField.create({
      name: name.trim(),
      isActive: isActive !== undefined ? isActive : true,
      createdBy: req.user._id
    });

    await createAuditLog(
      req.user._id,
      `Created custom field: ${customField.name}`,
      'Create',
      'CustomField',
      customField._id,
      null,
      customField.toObject(),
      req.ip
    );

    // Emit socket event for real-time updates
    const { emitCustomFieldUpdate } = require('../utils/socketService');
    emitCustomFieldUpdate('created', customField.toObject());

    res.status(201).json({
      success: true,
      message: 'Custom field created successfully',
      customField: customField.toObject()
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Custom field with this name already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create custom field'
    });
  }
};

// @desc    Get custom fields
// @route   GET /api/collection-custom-fields
// @access  Private
exports.getCustomFields = async (req, res) => {
  try {
    const { isActive } = req.query;
    const query = {};
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const customFields = await CustomField.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: customFields.length,
      customFields: customFields.map(field => field.toObject())
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get custom fields'
    });
  }
};

// @desc    Update custom field
// @route   PUT /api/collection-custom-fields/:id
// @access  Private (Admin, SuperAdmin)
exports.updateCustomField = async (req, res) => {
  try {
    const customField = await CustomField.findById(req.params.id);

    if (!customField) {
      return res.status(404).json({
        success: false,
        message: 'Custom field not found'
      });
    }

    const previousValue = customField.toObject();
    const { name, isActive, useInCollections } = req.body;

    // Check if name is being changed and if new name already exists
    if (name && name.trim() !== customField.name) {
      const existingField = await CustomField.findOne({ 
        name: name.trim(),
        _id: { $ne: customField._id }
      });

      if (existingField) {
        return res.status(400).json({
          success: false,
          message: 'Custom field with this name already exists'
        });
      }
    }

    // Update fields
    if (name !== undefined) customField.name = name.trim();
    if (isActive !== undefined) customField.isActive = isActive;
    if (useInCollections !== undefined) customField.useInCollections = useInCollections;

    await customField.save();

    await createAuditLog(
      req.user._id,
      `Updated custom field: ${customField.name}`,
      'Update',
      'CustomField',
      customField._id,
      previousValue,
      customField.toObject(),
      req.ip
    );

    // Emit socket event for real-time updates
    const { emitCustomFieldUpdate } = require('../utils/socketService');
    emitCustomFieldUpdate('updated', customField.toObject());

    res.status(200).json({
      success: true,
      message: 'Custom field updated successfully',
      customField: customField.toObject()
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Custom field with this name already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update custom field'
    });
  }
};

// @desc    Delete custom field
// @route   DELETE /api/collection-custom-fields/:id
// @access  Private (Admin, SuperAdmin)
exports.deleteCustomField = async (req, res) => {
  try {
    const customField = await CustomField.findById(req.params.id);

    if (!customField) {
      return res.status(404).json({
        success: false,
        message: 'Custom field not found'
      });
    }

    const previousValue = customField.toObject();

    await CustomField.findByIdAndDelete(req.params.id);

    await createAuditLog(
      req.user._id,
      `Deleted custom field: ${previousValue.name}`,
      'Delete',
      'CustomField',
      req.params.id,
      previousValue,
      null,
      req.ip
    );

    // Emit socket event for real-time updates
    const { emitCustomFieldUpdate } = require('../utils/socketService');
    emitCustomFieldUpdate('deleted', previousValue);

    res.status(200).json({
      success: true,
      message: 'Custom field deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete custom field'
    });
  }
};

