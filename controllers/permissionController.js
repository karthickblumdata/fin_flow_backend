const Permission = require('../models/permissionModel');
const { createAuditLog } = require('../utils/auditLogger');

// @desc    Create a new permission
// @route   POST /api/permissions/create
// @access  Private (SuperAdmin only)
exports.createPermission = async (req, res) => {
  try {
    console.log('\n🔐 ===== CREATE PERMISSION REQUEST =====');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   Request Body:', req.body);
    console.log('   Created By:', req.user?.email || 'unknown');
    console.log('========================================\n');

    const { permissionId, label, description, category } = req.body;

    // Validation
    if (!permissionId || !permissionId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Permission ID is required'
      });
    }

    if (!label || !label.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Permission label is required'
      });
    }

    if (!category || !category.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Permission category is required'
      });
    }

    // Check if permission already exists
    const existingPermission = await Permission.findOne({ 
      permissionId: permissionId.trim().toLowerCase() 
    });

    if (existingPermission) {
      return res.status(400).json({
        success: false,
        message: `Permission '${permissionId}' already exists`
      });
    }

    // Create permission
    const permission = await Permission.create({
      permissionId: permissionId.trim().toLowerCase(),
      label: label.trim(),
      description: description ? description.trim() : undefined,
      category: category.trim(),
      createdBy: req.user._id
    });

    console.log('✅ Permission created successfully:', {
      permissionId: permission.permissionId,
      label: permission.label
    });

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Created permission: ${permission.permissionId}`,
      'Create',
      'Permission',
      permission._id,
      null,
      permission.toObject(),
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Permission created successfully',
      permission: {
        _id: permission._id,
        permissionId: permission.permissionId,
        label: permission.label,
        description: permission.description,
        category: permission.category,
        createdAt: permission.createdAt,
        updatedAt: permission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating permission:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: `Permission '${req.body.permissionId}' already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all permissions
// @route   GET /api/permissions
// @access  Private (SuperAdmin only)
exports.getAllPermissions = async (req, res) => {
  try {
    const permissions = await Permission.find()
      .sort({ category: 1, permissionId: 1 })
      .select('-__v');

    res.status(200).json({
      success: true,
      count: permissions.length,
      permissions: permissions.map(p => ({
        _id: p._id,
        permissionId: p.permissionId,
        label: p.label,
        description: p.description,
        category: p.category,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }))
    });
  } catch (error) {
    console.error('❌ Error getting permissions:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get permission by ID
// @route   GET /api/permissions/:id
// @access  Private (SuperAdmin only)
exports.getPermissionById = async (req, res) => {
  try {
    const permission = await Permission.findById(req.params.id);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'Permission not found'
      });
    }

    res.status(200).json({
      success: true,
      permission: {
        _id: permission._id,
        permissionId: permission.permissionId,
        label: permission.label,
        description: permission.description,
        category: permission.category,
        createdAt: permission.createdAt,
        updatedAt: permission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error getting permission:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update permission
// @route   PUT /api/permissions/:id
// @access  Private (SuperAdmin only)
exports.updatePermission = async (req, res) => {
  try {
    const { label, description, category } = req.body;

    const permission = await Permission.findById(req.params.id);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'Permission not found'
      });
    }

    const oldData = {
      label: permission.label,
      description: permission.description,
      category: permission.category
    };

    if (label) permission.label = label.trim();
    if (description !== undefined) permission.description = description ? description.trim() : undefined;
    if (category) permission.category = category.trim();

    await permission.save();

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Updated permission: ${permission.permissionId}`,
      'Update',
      'Permission',
      permission._id,
      oldData,
      permission.toObject(),
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Permission updated successfully',
      permission: {
        _id: permission._id,
        permissionId: permission.permissionId,
        label: permission.label,
        description: permission.description,
        category: permission.category,
        updatedAt: permission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating permission:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete permission
// @route   DELETE /api/permissions/:id
// @access  Private (SuperAdmin only)
exports.deletePermission = async (req, res) => {
  try {
    const permission = await Permission.findById(req.params.id);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'Permission not found'
      });
    }

    const permissionData = {
      permissionId: permission.permissionId,
      label: permission.label
    };

    await Permission.findByIdAndDelete(req.params.id);

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Deleted permission: ${permission.permissionId}`,
      'Delete',
      'Permission',
      permission._id,
      permissionData,
      null,
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Permission deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting permission:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

