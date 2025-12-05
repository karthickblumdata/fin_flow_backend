# Super Admin Dashboard Backend API

This document describes the backend API endpoints for the Super Admin Dashboard.

## Base URL
```
http://localhost:4455/api
```

## Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

---

## Dashboard Endpoints

### 1. Get Dashboard Data
Get general dashboard data including pending counts, recent activities, and recent transactions/expenses.

**Endpoint:** `GET /api/dashboard`

**Access:** SuperAdmin, Admin

**Response:**
```json
{
  "success": true,
  "dashboard": {
    "totalUsers": 10,
    "totalTransactions": 50,
    "totalCollections": 30,
    "totalExpenses": 20,
    "pendingTransactions": 5,
    "pendingCollections": 3,
    "pendingExpenses": 2,
    "totalBalance": 100000,
    "recentActivity": [
      {
        "id": "...",
        "type": "Collection",
        "action": "Create",
        "actionText": "Created collection: V001",
        "user": {
          "id": "...",
          "name": "John Doe",
          "email": "john@example.com",
          "role": "Staff"
        },
        "entityId": "...",
        "timestamp": "2024-01-01T00:00:00.000Z",
        "notes": "..."
      }
    ],
    "recentTransactions": [
      {
        "id": "...",
        "date": "2024-01-01T00:00:00.000Z",
        "sender": {
          "id": "...",
          "name": "User 1",
          "email": "user1@example.com"
        },
        "receiver": {
          "id": "...",
          "name": "User 2",
          "email": "user2@example.com"
        },
        "initiatedBy": {
          "id": "...",
          "name": "Admin",
          "email": "admin@example.com"
        },
        "amount": 1000,
        "mode": "Cash",
        "purpose": "Payment",
        "status": "Approved",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "recentExpenses": [
      {
        "id": "...",
        "date": "2024-01-01T00:00:00.000Z",
        "userId": {
          "id": "...",
          "name": "User 1",
          "email": "user1@example.com"
        },
        "category": "Office",
        "amount": 500,
        "mode": "UPI",
        "description": "Office supplies",
        "status": "Approved",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

### 2. Get Financial Data
Get combined financial data (expenses, transactions, collections) with filtering, summary, and breakdown.

**Endpoint:** `GET /api/dashboard/financial`

**Access:** SuperAdmin, Admin

**Query Parameters:**
- `type` (optional): Filter by type - `'Expenses'`, `'Transactions'`, `'Collections'`, or `null` for all
- `status` (optional): Filter by status - `'Approved'`, `'Unapproved'`, `'Verified'`, `'Accountant'`, or `null` for all
- `mode` (optional): Filter by payment mode - `'Cash'`, `'UPI'`, `'Bank'`, or `null` for all
- `startDate` (optional): ISO date string - Start date for filtering
- `endDate` (optional): ISO date string - End date for filtering

**Example Request:**
```
GET /api/dashboard/financial?type=Expenses&status=Approved&mode=Cash&startDate=2024-01-01&endDate=2024-12-31
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "type": "Expenses",
      "date": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "userId": {
        "id": "...",
        "name": "User 1",
        "email": "user1@example.com"
      },
      "from": "User 1",
      "to": "-",
      "category": "Office",
      "amount": 500,
      "mode": "Cash",
      "description": "Office supplies",
      "status": "Approved",
      "createdBy": {
        "id": "...",
        "name": "Admin",
        "email": "admin@example.com"
      }
    },
    {
      "id": "...",
      "type": "Transactions",
      "date": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "sender": {
        "id": "...",
        "name": "User 1",
        "email": "user1@example.com"
      },
      "receiver": {
        "id": "...",
        "name": "User 2",
        "email": "user2@example.com"
      },
      "initiatedBy": {
        "id": "...",
        "name": "Admin",
        "email": "admin@example.com"
      },
      "from": "User 1",
      "to": "User 2",
      "amount": 1000,
      "mode": "UPI",
      "purpose": "Payment",
      "status": "Approved"
    },
    {
      "id": "...",
      "type": "Collections",
      "date": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "collectedBy": {
        "id": "...",
        "name": "Staff 1",
        "email": "staff1@example.com"
      },
      "assignedReceiver": {
        "id": "...",
        "name": "Admin",
        "email": "admin@example.com"
      },
      "from": "Staff 1",
      "to": "Admin",
      "customerName": "Customer ABC",
      "amount": 2000,
      "mode": "Bank",
      "voucherNumber": "V001",
      "status": "Approved",
      "notes": "Payment received"
    }
  ],
  "summary": {
    "cashIn": 50000,
    "cashOut": 20000,
    "balance": 30000
  },
  "filterBreakdown": {
    "Expenses": {
      "Approved": {
        "count": 10,
        "amount": 20000
      },
      "Unapproved": {
        "count": 5,
        "amount": 5000
      }
    },
    "Transactions": {
      "Approved": {
        "count": 20,
        "amount": 30000
      },
      "Unapproved": {
        "count": 8,
        "amount": 8000
      }
    },
    "Collections": {
      "Verified": {
        "count": 15,
        "amount": 50000
      },
      "Accountant": {
        "count": 5,
        "amount": 10000
      }
    }
  }
}
```

**Status Mapping:**
- For Collections: `'Approved'` is treated as `'Verified'` in the frontend
- For Collections: `'Pending'` is treated as `'Accountant'` in the frontend
- For Expenses/Transactions: `'Completed'` is treated as `'Approved'` in the frontend

**Financial Summary Calculation:**
- **Cash In**: Sum of Collections with status `'Verified'` or `'Approved'`
- **Cash Out**: Sum of Expenses with status `'Approved'` or `'Completed'`
- **Balance**: Cash In - Cash Out

---

## Error Responses

All endpoints may return the following error responses:

**401 Unauthorized:**
```json
{
  "success": false,
  "message": "Not authorized, token failed"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Access denied. SuperAdmin or Admin role required."
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Error message here"
}
```

---

## Notes

1. All dates are returned in ISO 8601 format (UTC)
2. Amounts are in the base currency unit (e.g., rupees)
3. The financial data endpoint supports filtering by multiple criteria simultaneously
4. Data is sorted by date (newest first) in the response
5. The endpoint automatically populates user references (sender, receiver, collectedBy, etc.)
6. Status normalization is handled in the backend to match frontend expectations

