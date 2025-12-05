const Role = require('../models/roleModel');
const { createAuditLog } = require('../utils/auditLogger');

// @desc    Create a new role with permissions
// @route   POST /api/roles/create
// @access  Private (SuperAdmin only)
exports.createRole = async (req, res) => {
  try {
    console.log('\n🔐 ===== CREATE ROLE REQUEST =====');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   IP:', req.ip || req.connection.remoteAddress);
    console.log('   Request Body:', {
      roleName: req.body?.roleName || 'not provided',
      name: req.body?.name || 'not provided',
      permissionIds: req.body?.permissionIds?.length || 0
    });
    console.log('   Created By:', req.user?.email || 'unknown');
    console.log('   Creator Role:', req.user?.role || 'unknown');
    console.log('===============================\n');

    const { roleName, permissionIds, name } = req.body;

    // Validation
    if (!roleName || !roleName.trim()) {
      console.log('❌ Validation Failed: Role name is required');
      return res.status(400).json({
        success: false,
        message: 'Role name is required'
      });
    }

    if (!permissionIds || !Array.isArray(permissionIds) || permissionIds.length === 0) {
      console.log('❌ Validation Failed: Permission IDs are required');
      return res.status(400).json({
        success: false,
        message: 'At least one permission is required'
      });
    }

    // Check if role already exists
    const existingRole = await Role.findOne({ roleName: roleName.trim() });
    if (existingRole) {
      console.log('❌ Role Creation Failed: Role already exists');
      console.log('   Role Name:', roleName);
      return res.status(400).json({
        success: false,
        message: `Role '${roleName}' already exists`
      });
    }

    // Normalize permission IDs: trim, filter out empty strings and 'root'
    const normalizedPermissionIds = permissionIds
      .map(id => typeof id === 'string' ? id.trim() : String(id).trim())
      .filter(id => id.length > 0 && id !== 'root' && id.toLowerCase() !== 'root');
    
    if (normalizedPermissionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one valid permission ID is required'
      });
    }

    // Create role
    const role = await Role.create({
      roleName: roleName.trim(),
      name: name && name.trim() ? name.trim() : undefined,
      permissionIds: normalizedPermissionIds,
      createdBy: req.user._id,
      updatedBy: req.user._id
    });
    
    console.log('📝 Normalized permission IDs for new role:', {
      originalCount: permissionIds.length,
      normalizedCount: normalizedPermissionIds.length,
      sampleIds: normalizedPermissionIds.slice(0, 5)
    });

    console.log('✅ Role created successfully:', {
      roleId: role._id,
      roleName: role.roleName,
      permissionsCount: role.permissionIds.length
    });

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Created role: ${role.roleName} with ${role.permissionIds.length} permissions`,
      'Create',
      'Role',
      role._id,
      null,
      role.toObject(),
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      role: {
        _id: role._id,
        roleName: role.roleName,
        name: role.name,
        permissionIds: role.permissionIds,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating role:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: `Role '${req.body.roleName}' already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create role'
    });
  }
};

// @desc    Get permissions for a specific role
// @route   GET /api/roles/:roleName/permissions
// @access  Private
exports.getRolePermissions = async (req, res) => {
  try {
    const { roleName } = req.params;

    if (!roleName) {
      return res.status(400).json({
        success: false,
        message: 'Role name is required'
      });
    }

    const role = await Role.findOne({ roleName: roleName.trim() });

    if (!role) {
      // Return empty permissions if role doesn't exist
      return res.status(200).json({
        success: true,
        role: roleName,
        permissions: []
      });
    }

    res.status(200).json({
      success: true,
      role: role.roleName,
      permissions: role.permissionIds || []
    });
  } catch (error) {
    console.error('❌ Error getting role permissions:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get role permissions'
    });
  }
};

// @desc    Update permissions for a specific role
// @route   PUT /api/roles/:roleName/permissions
// @access  Private (SuperAdmin only)
exports.updateRolePermissions = async (req, res) => {
  try {
    console.log('\n🔐 ===== UPDATE ROLE PERMISSIONS REQUEST =====');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   IP:', req.ip || req.connection.remoteAddress);
    console.log('   Role Name:', req.params?.roleName || 'not provided');
    console.log('   Permission IDs Count:', req.body?.permissionIds?.length || 0);
    console.log('   Updated By:', req.user?.email || 'unknown');
    console.log('   Updater Role:', req.user?.role || 'unknown');
    console.log('===============================\n');

    const { roleName } = req.params;
    const { permissionIds, name } = req.body;

    // Validation
    if (!roleName) {
      return res.status(400).json({
        success: false,
        message: 'Role name is required'
      });
    }

    if (!permissionIds || !Array.isArray(permissionIds)) {
      return res.status(400).json({
        success: false,
        message: 'Permission IDs array is required'
      });
    }

    // Find role
    const role = await Role.findOne({ roleName: roleName.trim() });

    if (!role) {
      console.log('❌ Role Update Failed: Role not found');
      console.log('   Role Name:', roleName);
      return res.status(404).json({
        success: false,
        message: `Role '${roleName}' not found`
      });
    }

    // Store old permissions for audit
    const oldPermissions = [...role.permissionIds];

    // Normalize permission IDs: trim, filter out empty strings and 'root'
    const normalizedPermissionIds = permissionIds
      .map(id => typeof id === 'string' ? id.trim() : String(id).trim())
      .filter(id => id.length > 0 && id !== 'root' && id.toLowerCase() !== 'root');

    // Update permissions
    role.permissionIds = normalizedPermissionIds;
    role.updatedBy = req.user._id;
    await role.save();
    
    console.log('📝 Normalized permission IDs:', {
      originalCount: permissionIds.length,
      normalizedCount: normalizedPermissionIds.length,
      sampleIds: normalizedPermissionIds.slice(0, 5)
    });

    console.log('✅ Role permissions updated successfully:', {
      roleId: role._id,
      roleName: role.roleName,
      oldPermissionsCount: oldPermissions.length,
      newPermissionsCount: role.permissionIds.length
    });

    // Create audit log
    await createAuditLog(
      req.user._id,
      `Updated permissions for role: ${role.roleName}`,
      'Update',
      'Role',
      role._id,
      { permissionIds: oldPermissions },
      { permissionIds: role.permissionIds },
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Role permissions updated successfully',
      role: {
        _id: role._id,
        roleName: role.roleName,
        name: role.name,
        permissionIds: role.permissionIds,
        updatedAt: role.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating role permissions:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update role permissions'
    });
  }
};

// @desc    Get all roles
// @route   GET /api/roles
// @access  Private (SuperAdmin only)
exports.getAllRoles = async (req, res) => {
  try {
    const roles = await Role.find()
      .select('roleName name permissionIds createdAt updatedAt')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      roles: roles,
      count: roles.length
    });
  } catch (error) {
    console.error('❌ Error getting all roles:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get roles'
    });
  }
};

