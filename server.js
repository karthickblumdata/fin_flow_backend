require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const connectDB = require('./config/db');
const { initializeSocket } = require('./utils/socketService');

// Import routes
const authRoutes = require('./routes/authRoutes');
const otpRoutes = require('./routes/otpRoutes');
const userRoutes = require('./routes/userRoutes');
const walletRoutes = require('./routes/walletRoutes');
const accountRoutes = require('./routes/accountRoutes');
const pendingApprovalRoutes = require('./routes/pendingApprovalRoutes');
const smartApprovalRoutes = require('./routes/smartApprovalRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const collectionRoutes = require('./routes/collectionRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const expenseReportRoutes = require('./routes/expenseReportRoutes');
const expenseReportScreenRoutes = require('./routes/expenseReportScreenRoutes');
const expenseTypeRoutes = require('./routes/expenseTypeRoutes');
const paymentModeRoutes = require('./routes/paymentModeRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const reportRoutes = require('./routes/reportRoutes');
const cashFlowRoutes = require('./routes/cashFlowRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const roleRoutes = require('./routes/roleRoutes');
const permissionRoutes = require('./routes/permissionRoutes');
const allWalletReportsRoutes = require('./routes/allWalletReportsRoutes');
const customFieldRoutes = require('./routes/customFieldRoutes');

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for Flutter development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads directory
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/pending-approvals', pendingApprovalRoutes);
app.use('/api/smart-approvals', smartApprovalRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/expenses/report', expenseReportRoutes);
app.use('/api/expense-report-screen', expenseReportScreenRoutes);
app.use('/api/expense-types', expenseTypeRoutes);
app.use('/api/payment-modes', paymentModeRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/cashflow', cashFlowRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/all-wallet-reports', allWalletReportsRoutes);
app.use('/api/collection-custom-fields', customFieldRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// Initialize Socket.IO
initializeSocket(server);

const PORT = process.env.PORT || 4455;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Socket.IO: Enabled (Real-time updates for Super Admin)`);
  console.log(`   Available on: http://0.0.0.0:${PORT} (accessible from emulator via 10.0.2.2:${PORT})`);
  console.log(`✅ [ALL WALLET REPORTS] Backend module loaded`);
  console.log(`✅ [ALL WALLET REPORTS] Routes registered: /api/all-wallet-reports`);
  console.log(`✅ [ALL WALLET REPORTS] Database connection ready`);
});
