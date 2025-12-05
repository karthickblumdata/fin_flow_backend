# Socket.IO Setup Guide

## Backend Setup (Already Installed ✅)

Socket.IO is already installed in the backend.

### Installation Status
```bash
npm list socket.io
# Output: socket.io@4.8.1
```

### If you need to reinstall:
```bash
cd backend
npm install socket.io
```

### Backend Files Created:
- `backend/utils/socketService.js` - Socket.IO server configuration
- `backend/utils/amountUpdateHelper.js` - Real-time update helper
- `backend/server.js` - Updated to initialize Socket.IO

---

## Flutter Client Setup (For Real-time Updates in Flutter App)

To connect your Flutter app to receive real-time updates, you need to install the Socket.IO client.

### Step 1: Add Socket.IO Client to Flutter

Edit `flutter_project_1/pubspec.yaml` and add:

```yaml
dependencies:
  socket_io_client: ^2.0.3+1
  # ... your existing dependencies
```

### Step 2: Install the Package

```bash
cd flutter_project_1
flutter pub get
```

### Step 3: Create Socket Service (Example)

Create `flutter_project_1/lib/services/socket_service.dart`:

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:shared_preferences/shared_preferences.dart';

class SocketService {
  static IO.Socket? _socket;
  static bool _isConnected = false;

  // Get socket instance
  static IO.Socket? get socket => _socket;

  static bool get isConnected => _isConnected;

  // Connect to Socket.IO server
  static Future<void> connect() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token');
      
      if (token == null) {
        print('No token found. Cannot connect to socket.');
        return;
      }

      // Socket.IO server URL
      // For Android Emulator: http://10.0.2.2:4455
      // For iOS Simulator: http://localhost:4455
      // For Physical Device: http://YOUR_COMPUTER_IP:4455
      const socketUrl = 'http://192.168.0.118:4455'; // Update this with your IP

      _socket = IO.io(
        socketUrl,
        IO.OptionBuilder()
            .setTransports(['websocket'])
            .setAuth({'token': token})
            .setExtraHeaders({'Authorization': 'Bearer $token'})
            .enableAutoConnect()
            .enableReconnection()
            .build(),
      );

      _socket!.onConnect((_) {
        print('Socket connected: ${_socket!.id}');
        _isConnected = true;
      });

      _socket!.onDisconnect((_) {
        print('Socket disconnected');
        _isConnected = false;
      });

      _socket!.onError((error) {
        print('Socket error: $error');
      });

      // Listen for amount updates
      _socket!.on('amountUpdate', (data) {
        print('Amount update received: $data');
        // Handle the update - update your UI or state management
      });

      // Listen for dashboard updates
      _socket!.on('dashboardUpdate', (data) {
        print('Dashboard update received: $data');
        // Handle the update - update your dashboard
      });

    } catch (e) {
      print('Error connecting to socket: $e');
    }
  }

  // Disconnect from Socket.IO server
  static void disconnect() {
    if (_socket != null) {
      _socket!.disconnect();
      _socket!.dispose();
      _socket = null;
      _isConnected = false;
    }
  }
}
```

### Step 4: Connect on SuperAdmin Login

In your login service or after successful SuperAdmin login:

```dart
// After successful login
if (userRole == 'SuperAdmin') {
  await SocketService.connect();
}
```

### Step 5: Disconnect on Logout

```dart
// On logout
SocketService.disconnect();
```

---

## Socket.IO Events

### Events Emitted by Backend:

1. **`amountUpdate`** - Emitted when wallet amounts change
   ```dart
   {
     "type": "wallet_add" | "wallet_withdraw" | "transaction" | "collection" | "expense",
     "details": { ... },
     "systemBalance": {
       "totalBalance": 0,
       "cashTotal": 0,
       "upiTotal": 0,
       "bankTotal": 0
     },
     "timestamp": "2024-01-01T00:00:00.000Z"
   }
   ```

2. **`dashboardUpdate`** - Emitted with dashboard statistics
   ```dart
   {
     "totalBalance": 0,
     "totalUsers": 0,
     "totalTransactions": 0,
     "totalCollections": 0,
     "totalExpenses": 0,
     "pendingTransactions": 0,
     "pendingCollections": 0,
     "pendingExpenses": 0,
     "systemBalance": { ... },
     "timestamp": "2024-01-01T00:00:00.000Z"
   }
   ```

---

## Testing Socket.IO Connection

### Backend Test:
1. Start the backend server:
   ```bash
   cd backend
   npm run dev
   ```

2. You should see:
   ```
   ✅ Server running on port 4455
   Socket.IO: Enabled (Real-time updates for Super Admin)
   ```

### Flutter Test:
1. Connect to socket after SuperAdmin login
2. Perform an action (add amount, approve transaction, etc.)
3. Check Flutter console for socket events

---

## Troubleshooting

### Backend Issues:
- **Socket.IO not initializing**: Check `server.js` has `initializeSocket(server)` called
- **No events emitted**: Check controllers have `notifyAmountUpdate()` calls
- **Connection errors**: Check CORS settings in `socketService.js`

### Flutter Issues:
- **Connection refused**: Check Socket.IO server URL is correct
- **Authentication failed**: Ensure JWT token is valid and passed correctly
- **No events received**: Verify user role is 'SuperAdmin' on backend
- **Package not found**: Run `flutter pub get` again

---

## Socket.IO Server URL Configuration

Update the socket URL based on your environment:

| Environment | URL Format |
|------------|------------|
| Android Emulator | `http://10.0.2.2:4455` |
| iOS Simulator | `http://localhost:4455` |
| Physical Device | `http://YOUR_COMPUTER_IP:4455` |

Find your computer's IP:
- **Windows**: Run `ipconfig` and look for IPv4 Address
- **Mac/Linux**: Run `ifconfig` and look for inet
