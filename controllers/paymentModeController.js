const PaymentMode = require('../models/paymentModeModel');
const { createAuditLog } = require('../utils/auditLogger');

// @desc    Create payment mode
// @route   POST /api/payment-modes
// @access  Private (Admin, SuperAdmin)
exports.createPaymentMode = async (req, res) => {
  try {
    const { modeName, description, autoPay, assignedReceiver } = req.body;

    // modeName is always required
    if (!modeName || modeName.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please provide modeName'
      });
    }

    // assignedReceiver is only required if autoPay is true
    const isAutoPay = autoPay === true || autoPay === 'true' || autoPay === true;
    if (isAutoPay && (!assignedReceiver || (typeof assignedReceiver === 'string' && assignedReceiver.trim() === ''))) {
      return res.status(400).json({
        success: false,
        message: 'Please provide assignedReceiver (user ID) when autoPay is enabled'
      });
    }

    const paymentMode = await PaymentMode.create({
      modeName: modeName.trim(),
      description: description ? description.trim() : undefined,
      autoPay: isAutoPay,
      assignedReceiver: assignedReceiver && assignedReceiver.trim() !== '' ? assignedReceiver : undefined,
      createdBy: req.user._id
    });

    await createAuditLog(
      req.user._id,
      `Created payment mode: ${modeName}`,
      'Create',
      'PaymentMode',
      paymentMode._id,
      null,
      paymentMode.toObject(),
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Payment mode created successfully',
      paymentMode
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get payment modes
// @route   GET /api/payment-modes
// @access  Private
exports.getPaymentModes = async (req, res) => {
  try {
    console.log('GET /api/payment-modes - Request received');
    console.log('User:', req.user ? { id: req.user._id, email: req.user.email, role: req.user.role } : 'Not found');
    console.log('Query params:', req.query);
    
    // Fetch only active payment modes for dropdowns and selections
    // Filter by isActive: true to return only active payment modes
    let paymentModes;
    try {
      paymentModes = await PaymentMode.find({ isActive: true })
        .sort({ createdAt: -1 })
        .lean();
      
      console.log(`Found ${paymentModes.length} active payment modes (before populate)`);
      
      // Now populate assignedReceiver for each mode separately to handle errors gracefully
      const User = require('../models/userModel');
      const modesWithPopulatedReceiver = await Promise.all(
        paymentModes.map(async (mode) => {
          if (mode.assignedReceiver) {
            try {
              const user = await User.findById(mode.assignedReceiver)
                .select('name email')
                .lean();
              return {
                ...mode,
                assignedReceiver: user || null
              };
            } catch (err) {
              console.warn(`Failed to populate assignedReceiver for mode ${mode._id}:`, err.message);
              return {
                ...mode,
                assignedReceiver: null
              };
            }
          }
          return {
            ...mode,
            assignedReceiver: null
          };
        })
      );

      console.log(`Successfully processed ${modesWithPopulatedReceiver.length} active payment modes`);

      res.status(200).json({
        success: true,
        count: modesWithPopulatedReceiver.length,
        paymentModes: modesWithPopulatedReceiver
      });
    } catch (dbError) {
      console.error('Database query error:', dbError);
      throw dbError;
    }
  } catch (error) {
    console.error('Error fetching payment modes:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Return 500 instead of letting it propagate as 400
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch payment modes',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// @desc    Update payment mode
// @route   PUT /api/payment-modes/:id
// @access  Private (Admin, SuperAdmin)
exports.updatePaymentMode = async (req, res) => {
  try {
    const paymentMode = await PaymentMode.findById(req.params.id);

    if (!paymentMode) {
      return res.status(404).json({
        success: false,
        message: 'Payment mode not found'
      });
    }

    const previousValue = paymentMode.toObject();
    const { description, autoPay, assignedReceiver, isActive } = req.body;

    if (description !== undefined) paymentMode.description = description;
    if (autoPay !== undefined) paymentMode.autoPay = autoPay;
    if (assignedReceiver !== undefined) paymentMode.assignedReceiver = assignedReceiver;
    if (isActive !== undefined) paymentMode.isActive = isActive;

    await paymentMode.save();

    await createAuditLog(
      req.user._id,
      `Updated payment mode: ${paymentMode.modeName}`,
      'Update',
      'PaymentMode',
      paymentMode._id,
      previousValue,
      paymentMode.toObject(),
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Payment mode updated successfully',
      paymentMode
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete payment mode
// @route   DELETE /api/payment-modes/:id
// @access  Private (Admin, SuperAdmin)
exports.deletePaymentMode = async (req, res) => {
  try {
    const paymentMode = await PaymentMode.findById(req.params.id);

    if (!paymentMode) {
      return res.status(404).json({
        success: false,
        message: 'Payment mode not found'
      });
    }

    paymentMode.isActive = false;
    await paymentMode.save();

    await createAuditLog(
      req.user._id,
      `Deleted payment mode: ${paymentMode.modeName}`,
      'Delete',
      'PaymentMode',
      paymentMode._id,
      paymentMode.toObject(),
      { isActive: false },
      req.ip
    );

    res.status(200).json({
      success: true,
      message: 'Payment mode deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
