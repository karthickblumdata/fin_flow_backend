# Backend Utilities

## Demo Pending Approvals Data

To make the Pending Approvals “Smart View” easier to test, you can seed two demo records (one transaction and one expense) that stay in a `Pending` state.

1. Make sure your `.env` file contains a valid `MONGO_URI` that points to the database you want to seed.
2. From the `backend` folder run:
   ```
   node scripts/seedPendingApprovals.js
   ```
3. Refresh the Flutter pending approvals screen; you should now see demo entries labelled `Smart View Demo Transfer` and `Smart View Demo Expense`.

You can rerun the script at any time—it upserts those demo rows and removes any older `Smart View Demo` entries that are no longer required.

To remove the demo data manually, delete the following documents from MongoDB:
- Transactions with purpose starting `Smart View Demo`
- Expenses with description starting `Smart View Demo`
- Optional: the three demo users (`demo.superadmin@example.com`, `demo.admin@example.com`, `demo.staff@example.com`)

> **Note:** The script creates the demo users automatically if they are missing. Passwords are set to `Password@123` so you can log in if required.
# Financial Flow Management System - Backend

Backend API for the Financial Flow Management System built with Express.js and MongoDB Atlas.

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- MongoDB Atlas account
- Gmail account for sending OTP emails

## Setup Instructions

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

The `.env` file has been created with the following configuration:

```
MONGO_URI=mongodb+srv://karthick11:karthick%4011@cluster0.mmxoq8r.mongodb.net/financial_flow_db?retryWrites=true&w=majority
JWT_SECRET=blumdata
EMAIL_USER=madhanbgmi8@gmail.com
EMAIL_PASS=pkzf lrgv jrew lucs
PORT=4455
NODE_ENV=development
```

**Important Notes:**
- The password in `MONGO_URI` is URL-encoded (`karthick@11` → `karthick%4011`)
- Make sure your MongoDB Atlas IP whitelist includes your current IP address
- The email password is the Gmail App Password (not your regular Gmail password)

### 3. MongoDB Atlas Configuration

1. **Network Access**: 
   - Go to MongoDB Atlas → Network Access
   - Click "Add IP Address"
   - Add your current IP address or use `0.0.0.0/0` for development (not recommended for production)

2. **Database User**:
   - Verify that user `karthick11` exists in your MongoDB Atlas cluster
   - Ensure the password is correct: `karthick@11`

### 4. Gmail App Password Setup

If you haven't already set up an App Password for Gmail:

1. Go to your Google Account settings
2. Enable 2-Step Verification (if not already enabled)
3. Go to App Passwords
4. Generate a new app password for "Mail"
5. Use the generated password in `EMAIL_PASS` (should be 16 characters without spaces)

## Running the Server

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

The server will start on `http://localhost:4455`

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login user
- `POST /api/auth/forgot-password` - Send OTP for password reset
- `POST /api/auth/reset-password` - Reset password with OTP

### OTP Management
- `POST /api/otp/send` - Send OTP
- `POST /api/otp/verify` - Verify OTP
- `POST /api/otp/set-password` - Set password after OTP verification

### Users (Protected)
- `POST /api/users/create` - Create new user (SuperAdmin/Admin only)
- `GET /api/users` - Get all users (SuperAdmin/Admin only)

### Wallet (Protected)
- `GET /api/wallet` - Get wallet balance
- `POST /api/wallet/add` - Add amount (SuperAdmin only)
- `POST /api/wallet/withdraw` - Withdraw amount (SuperAdmin only)

### Transactions (Protected)
- `POST /api/transactions` - Create transaction
- `GET /api/transactions` - Get transactions
- `POST /api/transactions/:id/approve` - Approve transaction (Admin/SuperAdmin)
- `POST /api/transactions/:id/reject` - Reject transaction (Admin/SuperAdmin)
- `POST /api/transactions/:id/cancel` - Cancel transaction
- `POST /api/transactions/:id/flag` - Flag transaction (Admin/SuperAdmin)

### Collections (Protected)
- `POST /api/collections` - Create collection (Staff only)
- `GET /api/collections` - Get collections
- `PUT /api/collections/:id` - Edit collection (Staff - own only)
- `POST /api/collections/:id/approve` - Approve collection (Admin/SuperAdmin)
- `POST /api/collections/:id/reject` - Reject collection (Admin/SuperAdmin)
- `POST /api/collections/:id/flag` - Flag collection (Admin/SuperAdmin)
- `POST /api/collections/:id/restore` - Restore rejected collection (Admin/SuperAdmin)

### Expenses (Protected)
- `POST /api/expenses` - Create expense
- `GET /api/expenses` - Get expenses
- `POST /api/expenses/:id/approve` - Approve expense (Admin/SuperAdmin)
- `POST /api/expenses/:id/reject` - Reject expense (Admin/SuperAdmin)
- `POST /api/expenses/:id/flag` - Flag expense (Admin/SuperAdmin)

### Payment Modes (Protected)
- `POST /api/payment-modes` - Create payment mode (Admin/SuperAdmin)
- `GET /api/payment-modes` - Get payment modes
- `PUT /api/payment-modes/:id` - Update payment mode (Admin/SuperAdmin)
- `DELETE /api/payment-modes/:id` - Delete payment mode (Admin/SuperAdmin)

### Dashboard (Protected)
- `GET /api/dashboard` - Get dashboard data (role-based)

### Reports (Protected)
- `GET /api/reports` - Get reports (Admin/SuperAdmin)
- `GET /api/reports/person-wise` - Get person-wise reports (Admin/SuperAdmin)

## Creating the First Super Admin

Since user creation requires authentication, you'll need to manually create the first Super Admin user. You can do this using MongoDB Compass or a script:

### Using MongoDB Compass:

1. Connect to your MongoDB Atlas cluster
2. Navigate to `financial_flow_db` database → `users` collection
3. Insert a new document:

```json
{
  "name": "Super Admin",
  "email": "superadmin@example.com",
  "password": "hashed_password_here",
  "role": "SuperAdmin",
  "isVerified": true,
  "createdAt": new Date(),
  "updatedAt": new Date()
}
```

**Note**: You'll need to hash the password first. You can use this Node.js snippet:

```javascript
const bcrypt = require('bcryptjs');
const hash = await bcrypt.hash('your_password', 10);
console.log(hash);
```

### Using a Script:

Create a file `create-superadmin.js`:

```javascript
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/userModel');

const createSuperAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const password = await bcrypt.hash('admin123', 10);
    
    const superAdmin = await User.create({
      name: 'Super Admin',
      email: 'superadmin@example.com',
      password: password,
      role: 'SuperAdmin',
      isVerified: true
    });

    console.log('Super Admin created:', superAdmin);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

createSuperAdmin();
```

Run it:
```bash
node create-superadmin.js
```

## Project Structure

```
backend/
├── config/
│   └── db.js                 # Database connection
├── controllers/              # Route handlers
│   ├── authController.js
│   ├── otpController.js
│   ├── userController.js
│   ├── walletController.js
│   ├── transactionController.js
│   ├── collectionController.js
│   ├── expenseController.js
│   ├── paymentModeController.js
│   ├── dashboardController.js
│   └── reportController.js
├── middleware/
│   └── authMiddleware.js     # Authentication & authorization
├── models/                   # Mongoose models
│   ├── userModel.js
│   ├── walletModel.js
│   ├── transactionModel.js
│   ├── collectionModel.js
│   ├── expenseModel.js
│   ├── paymentModeModel.js
│   └── auditLogModel.js
├── routes/                   # API routes
│   ├── authRoutes.js
│   ├── otpRoutes.js
│   ├── userRoutes.js
│   ├── walletRoutes.js
│   ├── transactionRoutes.js
│   ├── collectionRoutes.js
│   ├── expenseRoutes.js
│   ├── paymentModeRoutes.js
│   ├── dashboardRoutes.js
│   └── reportRoutes.js
├── utils/                    # Utility functions
│   ├── generateToken.js
│   ├── sendOtpEmail.js
│   ├── generateVoucherNumber.js
│   ├── walletHelper.js
│   └── auditLogger.js
├── .env                      # Environment variables
├── package.json
├── server.js                 # Main server file
└── README.md
```

## Testing the API

You can test the API using tools like Postman or cURL:

### Health Check
```bash
curl http://localhost:4455/api/health
```

### Login
```bash
curl -X POST http://localhost:4455/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@example.com","password":"admin123"}'
```

## Troubleshooting

### MongoDB Connection Error

If you get an authentication error:
1. Verify username and password in `.env`
2. Check MongoDB Atlas Network Access IP whitelist
3. Ensure password special characters are URL-encoded (`@` → `%40`)

### Email Not Sending

1. Verify Gmail App Password is correct
2. Check that 2-Step Verification is enabled
3. Ensure `EMAIL_USER` and `EMAIL_PASS` are correct in `.env`

### Port Already in Use

If port 4455 is already in use, change the `PORT` in `.env` or kill the process using that port.

## License

ISC
