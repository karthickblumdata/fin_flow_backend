# Self Wallet Real-Time Backend Implementation

## Overview
This document describes the backend API integration for real-time self wallet entries using Express.js and MongoDB with Socket.IO for real-time updates.

## Components Created/Updated

### 1. WalletTransaction Model (`backend/models/walletTransactionModel.js`)
A new MongoDB model to track all wallet entries/transactions:
- **Fields:**
  - `userId`: Reference to the user who owns the wallet
  - `walletId`: Reference to the wallet
  - `type`: Type of transaction (add, withdraw, transfer, expense, collection, transaction)
  - `mode`: Payment mode (Cash, UPI, Bank)
  - `amount`: Transaction amount
  - `operation`: Operation type (add, subtract, transfer_in, transfer_out)
  - `balanceAfter`: Wallet balances after the transaction
  - `notes`: Additional notes
  - `performedBy`: User who performed the operation
  - `status`: Transaction status (completed, pending, failed, cancelled)
  - Timestamps (createdAt, updatedAt)

### 2. Wallet Controller Updates (`backend/controllers/walletController.js`)

#### New Helper Function
- `createWalletTransaction()`: Creates a wallet transaction entry whenever a wallet operation occurs

#### Updated Functions
- `addAmount()`: Now creates a transaction entry and emits real-time updates
- `withdrawAmount()`: Now creates a transaction entry and emits real-time updates

#### New Endpoints

##### GET `/api/wallet/transactions`
Get wallet transactions (entries) for self wallet with filtering and pagination.

**Query Parameters:**
- `userId` (optional): User ID (defaults to current user)
- `startDate` (optional): Start date for filtering
- `endDate` (optional): End date for filtering
- `mode` (optional): Filter by payment mode (Cash, UPI, Bank)
- `type` (optional): Filter by transaction type (add, withdraw, transfer, expense, collection, transaction)
- `limit` (optional): Number of results per page (default: 50)
- `offset` (optional): Number of results to skip (default: 0)

**Response:**
```json
{
  "success": true,
  "transactions": [...],
  "count": 10,
  "total": 50,
  "limit": 50,
  "offset": 0
}
```

##### GET `/api/wallet/transactions/:id`
Get a specific wallet transaction by ID.

**Response:**
```json
{
  "success": true,
  "transaction": {
    "id": "...",
    "type": "add",
    "mode": "Cash",
    "amount": 1000,
    "operation": "add",
    "balanceAfter": {...},
    "notes": "...",
    "performedBy": {...},
    "createdAt": "...",
    ...
  }
}
```

### 3. Socket Service Updates (`backend/utils/socketService.js`)

#### New Features
- **User Socket Tracking**: Tracks all connected users (not just SuperAdmin) for self wallet updates
- **emitSelfWalletUpdate()**: New function to emit real-time wallet updates to specific users

#### Socket Events Emitted
- `selfWalletUpdate`: Emitted to the specific user when their wallet is updated
  - Contains: wallet balance, transaction details, update type

### 4. Routes Updates (`backend/routes/walletRoutes.js`)

#### New Routes
- `GET /api/wallet/transactions` - Get wallet transactions (protected)
- `GET /api/wallet/transactions/:id` - Get specific transaction (protected)

## Real-Time Updates Flow

1. **Wallet Operation Occurs** (e.g., add amount, withdraw amount)
2. **Transaction Entry Created** - A WalletTransaction document is created in MongoDB
3. **Real-Time Update Emitted** - Socket.IO emits `selfWalletUpdate` event to the target user
4. **Client Receives Update** - Flutter app receives the update and refreshes the wallet display

## API Endpoints Summary

### Wallet Operations
- `GET /api/wallet` - Get current user's wallet balance
- `POST /api/wallet/add` - Add amount to wallet (SuperAdmin only)
- `POST /api/wallet/withdraw` - Withdraw amount from wallet (SuperAdmin only)
- `GET /api/wallet/all` - Get all user wallets (SuperAdmin only)
- `GET /api/wallet/report` - Get wallet activity report (SuperAdmin/Admin)

### Wallet Transactions (New)
- `GET /api/wallet/transactions` - Get wallet transaction history
- `GET /api/wallet/transactions/:id` - Get specific transaction by ID

## Socket.IO Events

### Events Emitted by Backend
1. **selfWalletUpdate** - Emitted to specific user when their wallet is updated
   ```javascript
   {
     type: 'wallet_add' | 'wallet_withdraw',
     wallet: {
       cashBalance: number,
       upiBalance: number,
       bankBalance: number,
       totalBalance: number
     },
     transaction: {
       id: string,
       type: string,
       mode: string,
       amount: number,
       operation: string,
       createdAt: date
     },
     timestamp: string
   }
   ```

2. **amountUpdate** - Emitted to all SuperAdmins (existing)
3. **dashboardUpdate** - Emitted to all SuperAdmins (existing)

## Database Schema

### WalletTransaction Collection
```javascript
{
  userId: ObjectId,
  walletId: ObjectId,
  type: String, // 'add', 'withdraw', 'transfer', 'expense', 'collection', 'transaction'
  mode: String, // 'Cash', 'UPI', 'Bank'
  amount: Number,
  operation: String, // 'add', 'subtract', 'transfer_in', 'transfer_out'
  balanceAfter: {
    cashBalance: Number,
    upiBalance: Number,
    bankBalance: Number,
    totalBalance: Number
  },
  notes: String,
  performedBy: ObjectId,
  status: String, // 'completed', 'pending', 'failed', 'cancelled'
  createdAt: Date,
  updatedAt: Date
}
```

## Usage Example

### Getting Wallet Transactions
```javascript
// Get all transactions for current user
GET /api/wallet/transactions

// Get transactions with filters
GET /api/wallet/transactions?mode=Cash&type=add&limit=20&offset=0

// Get transactions for specific date range
GET /api/wallet/transactions?startDate=2024-01-01&endDate=2024-01-31
```

### Real-Time Updates in Flutter
The Flutter app should listen to the `selfWalletUpdate` event:
```dart
SocketService.onSelfWalletUpdate((data) {
  // Update wallet balance
  // Refresh transaction list
  // Show notification if needed
});
```

## Security

- All endpoints are protected with JWT authentication (`protect` middleware)
- Users can only access their own wallet transactions (unless SuperAdmin)
- SuperAdmin can access any user's transactions
- Socket.IO connections require valid JWT token

## Error Handling

- Invalid transaction IDs return 400 Bad Request
- Transaction not found returns 404 Not Found
- Access denied returns 403 Forbidden
- Server errors return 500 Internal Server Error

## Notes

- Transaction entries are created automatically when wallet operations occur
- Real-time updates are emitted to the target user immediately after wallet operations
- All wallet transactions are stored with complete audit trail (performedBy, timestamps, balanceAfter)
- The system supports filtering, pagination, and date range queries for efficient data retrieval

