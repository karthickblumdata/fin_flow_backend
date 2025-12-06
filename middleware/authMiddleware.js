const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      console.log(`[Auth Middleware] No token provided for ${req.method} ${req.path}`);
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.userId).select('-password -otp -otpExpiry');
      
      if (!req.user) {
        console.log(`[Auth Middleware] User not found for userId: ${decoded.userId}`);
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      next();
    } catch (error) {
      console.error(`[Auth Middleware] Token verification failed for ${req.method} ${req.path}:`, error.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
  } catch (error) {
    console.error(`[Auth Middleware] Unexpected error for ${req.method} ${req.path}:`, error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authentication'
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    // Log for debugging
    console.log(`[Authorize Middleware] Route: ${req.method} ${req.path}, User Role: ${req.user.role}, Required Roles: ${roles.join(', ')}`);
    
    if (!roles.includes(req.user.role)) {
      console.log(`[Authorize Middleware] ❌ Access denied for role '${req.user.role}' on ${req.method} ${req.path}`);
      return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`
      });
    }
    
    console.log(`[Authorize Middleware] ✅ Access granted for role '${req.user.role}' on ${req.method} ${req.path}`);
    next();
  };
};

// Permission-based authorization middleware
// Checks if user has any of the required permissions OR has the required role
const authorizeByPermission = (requiredPermission, allowedRoles = ['SuperAdmin']) => {
  return async (req, res, next) => {
    console.log(`\n[Permission Check] Route: ${req.method} ${req.path}`);
    console.log(`   User: ${req.user.email} (${req.user.role})`);
    console.log(`   Required Permission: ${requiredPermission}`);
    console.log(`   Allowed Roles: ${allowedRoles.join(', ')}`);
    
    // Check if user has required role
    if (allowedRoles.includes(req.user.role)) {
      console.log(`   ✅ Access granted: User has allowed role '${req.user.role}'`);
      return next();
    }
    
    // Refresh user data to get latest permissions (including userSpecificPermissions)
    // The protect middleware might not have loaded userSpecificPermissions
    let freshUser;
    try {
      freshUser = await User.findById(req.user._id);
      if (!freshUser) {
        console.log(`   ❌ Access denied: User not found`);
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }
    } catch (error) {
      console.error(`[Permission Check] Error fetching user: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error checking permissions'
      });
    }
    
    // Get user permissions (both role-based and user-specific)
    let allPermissions = [];
    
    // Get role-based permissions
    if (freshUser.role && freshUser.role !== 'SuperAdmin') {
      try {
        const Role = require('../models/roleModel');
        const role = await Role.findOne({ roleName: freshUser.role });
        if (role && role.permissionIds && role.permissionIds.length > 0) {
          allPermissions = [...role.permissionIds];
          console.log(`   Role '${freshUser.role}' has ${role.permissionIds.length} permissions`);
        } else {
          console.log(`   Role '${freshUser.role}' has no permissions or role not found`);
        }
      } catch (error) {
        console.error('Error fetching role permissions:', error);
      }
    }
    
    // Get user-specific permissions
    const userSpecificPermissions = freshUser.userSpecificPermissions || [];
    allPermissions = [...new Set([...allPermissions, ...userSpecificPermissions])];
    console.log(`   Total permissions: ${allPermissions.length} (role-based: ${allPermissions.length - userSpecificPermissions.length}, user-specific: ${userSpecificPermissions.length})`);
    if (allPermissions.length > 0) {
      console.log(`   Permissions: ${allPermissions.slice(0, 10).join(', ')}${allPermissions.length > 10 ? '...' : ''}`);
      // Show all payment mode related permissions for debugging
      const paymentModePerms = allPermissions.filter(p => p.includes('payment_modes') || p.includes('payment.modes'));
      if (paymentModePerms.length > 0) {
        console.log(`   Payment Mode Permissions: ${paymentModePerms.join(', ')}`);
      }
    }
    
    // Check if user has required permission
    const hasPermission = allPermissions.some(permission => {
      // Check exact match
      if (permission === requiredPermission) {
        return true;
      }
      
      // Check if user has wildcard permission (all access)
      if (permission === '*') {
        return true;
      }
      
      // Check if user has parent permission that grants access to child
      // e.g., if required is 'all_users.user_management' and user has 'all_users', grant access
      const requiredParts = requiredPermission.split('.');
      const userParts = permission.split('.');
      
      // If user has a parent permission, grant access to all children
      // e.g., 'all_users' grants access to 'all_users.user_management'
      if (userParts.length < requiredParts.length) {
        let matches = true;
        for (let i = 0; i < userParts.length; i++) {
          if (userParts[i] !== requiredParts[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return true; // User has parent permission
        }
      }
      
      // Check if user has child permission that starts with required permission
      // e.g., if required is 'all_users.user_management' and user has 'all_users.user_management.view', grant access
      if (permission.startsWith(requiredPermission + '.')) {
        return true;
      }
      
      // Special case: For manage operations, if user has view permission in the same section, grant access
      // e.g., if required is 'accounts.payment_modes.manage' and user has 'accounts.payment_modes.view', grant access
      // This allows users with view permission to also manage (if that's the intended behavior)
      if (requiredPermission.endsWith('.manage')) {
        const basePermission = requiredPermission.replace('.manage', '');
        if (permission.startsWith(basePermission + '.')) {
          // User has any permission in the same section (view, edit, delete, etc.)
          return true;
        }
      }
      
      return false;
    });
    
    if (hasPermission) {
      console.log(`   ✅ Access granted: User has required permission`);
      return next();
    }
    
    console.log(`   ❌ Access denied: User does not have permission '${requiredPermission}'`);
    return res.status(403).json({
      success: false,
      message: `User does not have permission '${requiredPermission}' to access this route`
    });
  };
};

// Permission-based authorization middleware that accepts multiple permissions (OR logic)
// Checks if user has ANY of the required permissions OR has the required role
const authorizeByAnyPermission = (requiredPermissions, allowedRoles = ['SuperAdmin']) => {
  return async (req, res, next) => {
    console.log(`\n[Permission Check] Route: ${req.method} ${req.path}`);
    console.log(`   User: ${req.user.email} (${req.user.role})`);
    console.log(`   Required Permissions (any of): ${Array.isArray(requiredPermissions) ? requiredPermissions.join(', ') : requiredPermissions}`);
    console.log(`   Allowed Roles: ${allowedRoles.join(', ')}`);
    
    // Check if user has required role
    if (allowedRoles.includes(req.user.role)) {
      console.log(`   ✅ Access granted: User has allowed role '${req.user.role}'`);
      return next();
    }
    
    // Refresh user data to get latest permissions (including userSpecificPermissions)
    let freshUser;
    try {
      freshUser = await User.findById(req.user._id);
      if (!freshUser) {
        console.log(`   ❌ Access denied: User not found`);
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }
    } catch (error) {
      console.error(`[Permission Check] Error fetching user: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error checking permissions'
      });
    }
    
    // Get user permissions (both role-based and user-specific)
    let allPermissions = [];
    
    // Get role-based permissions
    if (freshUser.role && freshUser.role !== 'SuperAdmin') {
      try {
        const Role = require('../models/roleModel');
        const role = await Role.findOne({ roleName: freshUser.role });
        if (role && role.permissionIds && role.permissionIds.length > 0) {
          allPermissions = [...role.permissionIds];
          console.log(`   Role '${freshUser.role}' has ${role.permissionIds.length} permissions`);
        } else {
          console.log(`   Role '${freshUser.role}' has no permissions or role not found`);
        }
      } catch (error) {
        console.error('Error fetching role permissions:', error);
      }
    }
    
    // Get user-specific permissions
    const userSpecificPermissions = freshUser.userSpecificPermissions || [];
    allPermissions = [...new Set([...allPermissions, ...userSpecificPermissions])];
    console.log(`   Total permissions: ${allPermissions.length} (role-based: ${allPermissions.length - userSpecificPermissions.length}, user-specific: ${userSpecificPermissions.length})`);
    if (allPermissions.length > 0) {
      console.log(`   Permissions: ${allPermissions.slice(0, 5).join(', ')}${allPermissions.length > 5 ? '...' : ''}`);
    }
    
    // Convert single permission to array for uniform handling
    const permissionsToCheck = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
    
    // Check if user has ANY of the required permissions
    let hasAnyPermission = false;
    for (const requiredPermission of permissionsToCheck) {
      const hasPermission = allPermissions.some(permission => {
        // Check exact match
        if (permission === requiredPermission) {
          return true;
        }
        
        // Check if user has wildcard permission (all access)
        if (permission === '*') {
          return true;
        }
        
        // Check if user has parent permission that grants access to child
        const requiredParts = requiredPermission.split('.');
        const userParts = permission.split('.');
        
        // If user has a parent permission, grant access to all children
        if (userParts.length < requiredParts.length) {
          let matches = true;
          for (let i = 0; i < userParts.length; i++) {
            if (userParts[i] !== requiredParts[i]) {
              matches = false;
              break;
            }
          }
          if (matches) {
            return true; // User has parent permission
          }
        }
        
        // Check if user has child permission that starts with required permission
        if (permission.startsWith(requiredPermission + '.')) {
          return true;
        }
        
        return false;
      });
      
      if (hasPermission) {
        hasAnyPermission = true;
        console.log(`   ✅ Access granted: User has permission '${requiredPermission}'`);
        break;
      }
    }
    
    if (hasAnyPermission) {
      return next();
    }
    
    console.log(`   ❌ Access denied: User does not have any of the required permissions: ${permissionsToCheck.join(', ')}`);
    return res.status(403).json({
      success: false,
      message: `User does not have permission to access this route. Required: ${permissionsToCheck.join(' OR ')}`
    });
  };
};

module.exports = { protect, authorize, authorizeByPermission, authorizeByAnyPermission };
