let io = null;
const superAdminSockets = new Map(); // Map of userId -> socketId
const userSockets = new Map(); // Map of userId -> socketId (for all users)

// Initialize socket.io
const initializeSocket = (server) => {
  io = require('socket.io')(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Socket authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    try {
      const jwt = require('jsonwebtoken');
      const User = require('../models/userModel');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Token uses 'userId' field
      const userId = decoded.userId || decoded.id;
      
      if (!userId) {
        return next(new Error('Authentication error: Invalid token payload'));
      }

      // Fetch user from database to get role and verify user exists
      const user = await User.findById(userId).select('-password -otp -otpExpiry');
      
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.userId = user._id;
      socket.userRole = user.role;
      
      next();
    } catch (error) {
      console.error('Socket authentication error:', error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    // Check if userId exists (should always exist after auth middleware, but safety check)
    if (!socket.userId) {
      console.error(`Socket connected without userId: ${socket.id}`);
      socket.disconnect();
      return;
    }

    const userId = socket.userId.toString();
    console.log(`Socket connected: ${socket.id} (User: ${userId}, Role: ${socket.userRole || 'Unknown'})`);

    // Register user socket for self wallet updates
    userSockets.set(userId, socket.id);

    // Only super admin can subscribe to amount updates
    if (socket.userRole === 'SuperAdmin') {
      superAdminSockets.set(userId, socket.id);
      console.log(`Super Admin socket registered: ${userId}`);
    }

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      if (socket.userId) {
        const userId = socket.userId.toString();
        userSockets.delete(userId);
        if (socket.userRole === 'SuperAdmin') {
          superAdminSockets.delete(userId);
        }
      }
    });
  });

  return io;
};

// Emit amount update to all super admin users
const emitAmountUpdate = (updateData) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  const data = {
    ...updateData,
    timestamp: new Date().toISOString()
  };

  // Emit to all super admin sockets
  superAdminSockets.forEach((socketId) => {
    io.to(socketId).emit('amountUpdate', data);
  });

  console.log(`Amount update emitted to ${superAdminSockets.size} super admin(s)`);
};

// Emit dashboard stats update to super admin
const emitDashboardUpdate = (stats) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  const data = {
    ...stats,
    timestamp: new Date().toISOString()
  };

  superAdminSockets.forEach((socketId) => {
    io.to(socketId).emit('dashboardUpdate', data);
  });
};

// Emit dashboard summary update to super admin (financial summary, status counts, flagged items)
const emitDashboardSummaryUpdate = async (summaryData = null) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  // If summaryData is provided, use it; otherwise fetch from dashboard controller
  let data = summaryData;
  if (!data) {
    try {
      const { getDashboardSummary } = require('../controllers/dashboardController');
      const mockReq = { user: { role: 'SuperAdmin', _id: null } };
      const mockRes = {
        status: () => mockRes,
        json: (result) => {
          if (result.success && result.data) {
            data = result.data;
          }
        }
      };
      
      // We can't easily call the controller function here, so we'll emit a refresh signal
      // The frontend will fetch the data when it receives this signal
      data = { refresh: true };
    } catch (error) {
      console.error('Error fetching dashboard summary:', error);
      data = { refresh: true };
    }
  }

  const emitData = {
    ...data,
    timestamp: new Date().toISOString()
  };

  superAdminSockets.forEach((socketId) => {
    io.to(socketId).emit('dashboardSummaryUpdate', emitData);
  });

  console.log(`Dashboard summary update emitted to ${superAdminSockets.size} super admin(s)`);
};

// Emit self wallet update to specific user
const emitSelfWalletUpdate = (userId, updateData) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  const socketId = userSockets.get(userId);
  if (!socketId) {
    console.log(`No active socket found for user: ${userId}`);
    return;
  }

  const data = {
    ...updateData,
    timestamp: new Date().toISOString()
  };

  io.to(socketId).emit('selfWalletUpdate', data);
  console.log(`Self wallet update emitted to user: ${userId}`);
};

    // Emit expense type update to all connected users
const emitExpenseTypeUpdate = (eventType, expenseTypeData) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  const data = {
    event: eventType, // 'created', 'updated', 'deleted'
    expenseType: expenseTypeData,
    timestamp: new Date().toISOString()
  };

  // Emit to all connected users (expense types affect all users)
  io.emit('expenseTypeUpdate', data);
  console.log(`Expense type ${eventType} event emitted to all users`);
};

// Emit expense update to all connected users (for expense report real-time updates)
const emitExpenseUpdate = (eventType, expenseData) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  const data = {
    event: eventType, // 'created', 'updated', 'deleted', 'approved', 'rejected', 'flagged'
    expense: expenseData,
    timestamp: new Date().toISOString()
  };

  // Emit appropriate event based on event type
  if (eventType === 'created') {
    io.emit('expenseCreated', data);
  } else {
    io.emit('expenseUpdated', data);
  }
  // Also emit generic update event
  io.emit('expenseUpdate', data);
  console.log(`Expense ${eventType} event emitted to all users`);
};

// Emit expense report update to all super admin users (full report data)
const emitExpenseReportUpdate = (reportData) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  const data = {
    ...reportData,
    timestamp: new Date().toISOString()
  };

  // Emit to all super admin sockets
  superAdminSockets.forEach((socketId) => {
    io.to(socketId).emit('expenseReportUpdate', data);
  });

  console.log(`Expense report update emitted to ${superAdminSockets.size} super admin(s)`);
};

// Emit expense report stats update to all super admin users (lightweight summary)
const emitExpenseReportStatsUpdate = (stats) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  const data = {
    ...stats,
    timestamp: new Date().toISOString()
  };

  // Emit to all super admin sockets
  superAdminSockets.forEach((socketId) => {
    io.to(socketId).emit('expenseReportStatsUpdate', data);
  });

  console.log(`Expense report stats update emitted to ${superAdminSockets.size} super admin(s)`);
};

// Emit expense summary update to all connected users
const emitExpenseSummaryUpdate = (summary) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  const data = {
    summary,
    timestamp: new Date().toISOString()
  };

  // Emit to all connected users
  io.emit('expense_summary_updated', data);
  console.log('Expense summary update emitted to all users');
};

// Emit dashboard totals update to all connected users
const emitDashboardTotalsUpdate = (totals) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  const data = {
    dashboard: totals,
    timestamp: new Date().toISOString()
  };

  // Emit to all connected users
  io.emit('dashboard_totals_updated', data);
  console.log('Dashboard totals update emitted to all users');
};

// Emit All Wallet Reports update to all SuperAdmins
const emitAllWalletReportsUpdate = async (updateData) => {
  if (!io) {
    console.warn('📊 [ALL WALLET REPORTS] Socket.IO not initialized');
    return;
  }

  console.log('📊 [ALL WALLET REPORTS] Wallet data changed, emitting update to SuperAdmins');

  const data = {
    type: 'totals_updated',
    totals: updateData.totals || null,
    userId: updateData.userId || null,
    timestamp: new Date().toISOString()
  };

  // Emit to all super admin sockets
  let emittedCount = 0;
  superAdminSockets.forEach((socketId) => {
    io.to(socketId).emit('allWalletReportsUpdate', data);
    emittedCount++;
  });

  console.log(`📊 [ALL WALLET REPORTS] Update emitted to ${emittedCount} SuperAdmin(s): ${JSON.stringify(data)}`);
};

// Emit pending approval update to all connected users (for Smart Approvals refresh)
const emitPendingApprovalUpdate = (updateData) => {
  if (!io) {
    console.warn('📋 [PENDING APPROVALS] Socket.IO not initialized');
    return;
  }

  const data = {
    ...updateData,
    timestamp: new Date().toISOString()
  };

  // Emit to all connected users (Smart Approvals can be accessed by multiple users)
  io.emit('pendingApprovalUpdate', data);
  console.log(`📋 [PENDING APPROVALS] Update emitted to all users: ${JSON.stringify(data)}`);
};

// Emit transaction update to all connected users (for real-time updates, same pattern as expense)
const emitTransactionUpdate = (eventType, transactionData) => {
  if (!io) {
    console.warn('💸 [TRANSACTION] Socket.IO not initialized');
    return;
  }

  const data = {
    event: eventType, // 'created', 'updated', 'deleted', 'approved', 'rejected', 'flagged', 'resubmitted'
    transaction: transactionData,
    timestamp: new Date().toISOString()
  };

  // Emit appropriate event based on event type
  if (eventType === 'created') {
    io.emit('transactionCreated', data);
  } else {
    io.emit('transactionUpdated', data);
  }
  // Also emit generic update event
  io.emit('transactionUpdate', data);
  console.log(`💸 [TRANSACTION] ${eventType} event emitted to all users`);
};

// Emit collection update to all connected users (for real-time updates, same pattern as expense)
const emitCollectionUpdate = (eventType, collectionData) => {
  if (!io) {
    console.warn('💰 [COLLECTION] Socket.IO not initialized');
    return;
  }

  const data = {
    event: eventType, // 'created', 'updated', 'deleted', 'approved', 'rejected', 'flagged', 'resubmitted'
    collection: collectionData,
    timestamp: new Date().toISOString()
  };

  // Emit appropriate event based on event type
  if (eventType === 'created') {
    io.emit('collectionCreated', data);
  } else {
    io.emit('collectionUpdated', data);
  }
  // Also emit generic update event
  io.emit('collectionUpdate', data);
  console.log(`💰 [COLLECTION] ${eventType} event emitted to all users`);
};

module.exports = {
  initializeSocket,
  emitAmountUpdate,
  emitDashboardUpdate,
  emitDashboardSummaryUpdate,
  emitSelfWalletUpdate,
  emitExpenseTypeUpdate,
  emitExpenseUpdate,
  emitExpenseReportUpdate,
  emitExpenseReportStatsUpdate,
  emitExpenseSummaryUpdate,
  emitDashboardTotalsUpdate,
  emitAllWalletReportsUpdate,
  emitPendingApprovalUpdate,
  emitTransactionUpdate,
  emitCollectionUpdate
};
