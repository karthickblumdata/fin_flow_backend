require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');
const Role = require('../models/roleModel');

async function showUserPermissions(email) {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.log(`❌ User not found with email: ${email}`);
      await mongoose.disconnect();
      return;
    }

    console.log('👤 ===== USER INFORMATION =====');
    console.log(`   Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   User ID: ${user._id}`);
    console.log('================================\n');

    // Get role-based permissions
    let rolePermissions = [];
    if (user.role && user.role !== 'SuperAdmin') {
      const role = await Role.findOne({ roleName: user.role });
      if (role && role.permissionIds && role.permissionIds.length > 0) {
        rolePermissions = role.permissionIds;
        console.log(`📋 Role Permissions (${rolePermissions.length}):`);
        rolePermissions.forEach(perm => console.log(`   - ${perm}`));
      } else {
        console.log('📋 Role Permissions: None (role not found or has no permissions)');
      }
    } else if (user.role === 'SuperAdmin') {
      console.log('📋 Role Permissions: SuperAdmin (all permissions)');
    }
    console.log('');

    // Get user-specific permissions
    const userSpecificPermissions = user.userSpecificPermissions || [];
    console.log(`🔐 User-Specific Permissions (${userSpecificPermissions.length}):`);
    if (userSpecificPermissions.length > 0) {
      userSpecificPermissions.forEach(perm => console.log(`   ✓ ${perm}`));
    } else {
      console.log('   (No user-specific permissions assigned)');
    }
    console.log('');

    // Combine permissions
    const allPermissions = [...new Set([...rolePermissions, ...userSpecificPermissions])];
    console.log(`📊 Total Combined Permissions: ${allPermissions.length}`);
    console.log('');

    // Build permission tree structure
    console.log('🌳 ===== PERMISSION TREE STRUCTURE =====');
    const permissionTree = {
      'dashboard': {
        'view': allPermissions.includes('dashboard.view'),
        'flagged_financial_flow': {
          'enable': allPermissions.includes('dashboard.flagged_financial_flow.enable')
        }
      },
      'wallet': {
        'self': {
          'transaction': {
            'create': allPermissions.includes('wallet.self.transaction.create'),
            'edit': allPermissions.includes('wallet.self.transaction.edit'),
            'delete': allPermissions.includes('wallet.self.transaction.delete'),
            'reject': allPermissions.includes('wallet.self.transaction.reject'),
            'flag': allPermissions.includes('wallet.self.transaction.flag'),
            'approve': allPermissions.includes('wallet.self.transaction.approve'),
            'export': allPermissions.includes('wallet.self.transaction.export'),
            'view': allPermissions.includes('wallet.self.transaction.view')
          },
          'expenses': {
            'create': allPermissions.includes('wallet.self.expenses.create'),
            'edit': allPermissions.includes('wallet.self.expenses.edit'),
            'delete': allPermissions.includes('wallet.self.expenses.delete'),
            'reject': allPermissions.includes('wallet.self.expenses.reject'),
            'flag': allPermissions.includes('wallet.self.expenses.flag'),
            'approve': allPermissions.includes('wallet.self.expenses.approve'),
            'export': allPermissions.includes('wallet.self.expenses.export'),
            'view': allPermissions.includes('wallet.self.expenses.view')
          },
          'collection': {
            'create': allPermissions.includes('wallet.self.collection.create'),
            'edit': allPermissions.includes('wallet.self.collection.edit'),
            'delete': allPermissions.includes('wallet.self.collection.delete'),
            'reject': allPermissions.includes('wallet.self.collection.reject'),
            'flag': allPermissions.includes('wallet.self.collection.flag'),
            'approve': allPermissions.includes('wallet.self.collection.approve'),
            'export': allPermissions.includes('wallet.self.collection.export'),
            'view': allPermissions.includes('wallet.self.collection.view')
          }
        },
        'all': {
          'transaction': {
            'create': allPermissions.includes('wallet.all.transaction.create'),
            'remove': allPermissions.includes('wallet.all.transaction.remove'),
            'reject': allPermissions.includes('wallet.all.transaction.reject'),
            'flag': allPermissions.includes('wallet.all.transaction.flag'),
            'approve': allPermissions.includes('wallet.all.transaction.approve'),
            'export': allPermissions.includes('wallet.all.transaction.export'),
            'view': allPermissions.includes('wallet.all.transaction.view')
          },
          'collection': {
            'create': allPermissions.includes('wallet.all.collection.create'),
            'remove': allPermissions.includes('wallet.all.collection.remove'),
            'reject': allPermissions.includes('wallet.all.collection.reject'),
            'flag': allPermissions.includes('wallet.all.collection.flag'),
            'approve': allPermissions.includes('wallet.all.collection.approve'),
            'export': allPermissions.includes('wallet.all.collection.export'),
            'view': allPermissions.includes('wallet.all.collection.view')
          },
          'expenses': {
            'create': allPermissions.includes('wallet.all.expenses.create'),
            'remove': allPermissions.includes('wallet.all.expenses.remove'),
            'reject': allPermissions.includes('wallet.all.expenses.reject'),
            'flag': allPermissions.includes('wallet.all.expenses.flag'),
            'approve': allPermissions.includes('wallet.all.expenses.approve'),
            'export': allPermissions.includes('wallet.all.expenses.export'),
            'view': allPermissions.includes('wallet.all.expenses.view')
          }
        }
      },
      'smart_approvals': {
        'transaction': {
          'create': allPermissions.includes('smart_approvals.transaction.create'),
          'reject': allPermissions.includes('smart_approvals.transaction.reject'),
          'flag': allPermissions.includes('smart_approvals.transaction.flag'),
          'approve': allPermissions.includes('smart_approvals.transaction.approve'),
          'export': allPermissions.includes('smart_approvals.transaction.export'),
          'view': allPermissions.includes('smart_approvals.transaction.view')
        },
        'collection': {
          'create': allPermissions.includes('smart_approvals.collection.create'),
          'reject': allPermissions.includes('smart_approvals.collection.reject'),
          'flag': allPermissions.includes('smart_approvals.collection.flag'),
          'approve': allPermissions.includes('smart_approvals.collection.approve'),
          'export': allPermissions.includes('smart_approvals.collection.export'),
          'view': allPermissions.includes('smart_approvals.collection.view')
        },
        'expenses': {
          'create': allPermissions.includes('smart_approvals.expenses.create'),
          'reject': allPermissions.includes('smart_approvals.expenses.reject'),
          'flag': allPermissions.includes('smart_approvals.expenses.flag'),
          'approve': allPermissions.includes('smart_approvals.expenses.approve'),
          'export': allPermissions.includes('smart_approvals.expenses.export'),
          'view': allPermissions.includes('smart_approvals.expenses.view')
        }
      },
      'all_users': {
        'user_management': {
          'create': allPermissions.includes('all_users.user_management.create'),
          'edit': allPermissions.includes('all_users.user_management.edit'),
          'view': allPermissions.includes('all_users.user_management.view')
        },
        'roles': {
          'edit': allPermissions.includes('all_users.roles.edit'),
          'create': allPermissions.includes('all_users.roles.create'),
          'delete': allPermissions.includes('all_users.roles.delete'),
          'view': allPermissions.includes('all_users.roles.view')
        }
      },
      'accounts': {
        'payment_account_reports': {
          'edit': allPermissions.includes('accounts.payment_account_reports.edit'),
          'create': allPermissions.includes('accounts.payment_account_reports.create'),
          'delete': allPermissions.includes('accounts.payment_account_reports.delete'),
          'export': allPermissions.includes('accounts.payment_account_reports.export'),
          'view': allPermissions.includes('accounts.payment_account_reports.view')
        }
      },
      'expenses': {
        'expenses_type': {
          'create': allPermissions.includes('expenses.expenses_type.create'),
          'edit': allPermissions.includes('expenses.expenses_type.edit'),
          'delete': allPermissions.includes('expenses.expenses_type.delete'),
          'view': allPermissions.includes('expenses.expenses_type.view')
        },
        'expenses_report': {
          'edit': allPermissions.includes('expenses.expenses_report.edit'),
          'create': allPermissions.includes('expenses.expenses_report.create'),
          'delete': allPermissions.includes('expenses.expenses_report.delete'),
          'export': allPermissions.includes('expenses.expenses_report.export'),
          'view': allPermissions.includes('expenses.expenses_report.view')
        }
      },
      'quick_actions': {
        'enable': allPermissions.includes('quick_actions.enable')
      }
    };

    function printTree(obj, prefix = '', isLast = true) {
      const keys = Object.keys(obj);
      keys.forEach((key, index) => {
        const isLastItem = index === keys.length - 1;
        const currentPrefix = prefix + (isLast ? '└── ' : '├── ');
        const nextPrefix = prefix + (isLast ? '    ' : '│   ');
        
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          const hasPermission = Object.values(obj[key]).some(v => v === true);
          const icon = hasPermission ? '✓' : '○';
          console.log(`${currentPrefix}${icon} ${key}`);
          printTree(obj[key], nextPrefix, isLastItem);
        } else {
          const icon = obj[key] === true ? '✓' : '○';
          console.log(`${currentPrefix}${icon} ${key}`);
        }
      });
    }

    printTree(permissionTree);
    console.log('\n✅ ===== END OF PERMISSION TREE =====\n');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Get email from command line argument or use default
const email = process.argv[2] || 'karthickbgmi8@gmail.com';
showUserPermissions(email);

