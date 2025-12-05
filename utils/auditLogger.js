const AuditLog = require('../models/auditLogModel');

const createAuditLog = async (userId, action, actionType, entityType, entityId, previousValue = null, newValue = null, ipAddress = null, notes = null) => {
  try {
    await AuditLog.create({
      userId,
      action,
      actionType,
      entityType,
      entityId,
      previousValue,
      newValue,
      ipAddress,
      notes
    });
  } catch (error) {
    console.error('Error creating audit log:', error);
  }
};

module.exports = { createAuditLog };
