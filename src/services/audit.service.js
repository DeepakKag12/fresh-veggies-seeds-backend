const AuditLog = require('../models/audit-log.model');
const DeleteHistory = require('../models/delete-history.model');

/**
 * Enterprise Audit and Deletion Ledger Service
 */
class AuditService {
  /**
   * Log administrative operation
   */
  async logAction({
    req,
    actor,
    action,
    entityType,
    entityId,
    entityName = '',
    details = {}
  }) {
    try {
      const actorInfo = actor || {
        userId: req?.user?._id,
        name: req?.user?.name || 'Administrator',
        email: req?.user?.email || '',
        role: req?.user?.role || 'admin'
      };

      const ipAddress = req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';

      const log = new AuditLog({
        actor: actorInfo,
        action,
        entityType,
        entityId,
        entityName,
        details,
        ipAddress
      });

      await log.save();
      return log;
    } catch (err) {
      console.error('⚠️  Failed to record audit log:', err.message);
      return null;
    }
  }

  /**
   * Record a soft deletion in both DeleteHistory recovery ledger and AuditLog
   */
  async logDeletion({
    req,
    entityType,
    entityId,
    entityName,
    deletionReason = 'Manual administrative deletion',
    snapshot = {}
  }) {
    try {
      const actorInfo = {
        userId: req?.user?._id,
        name: req?.user?.name || 'Administrator',
        email: req?.user?.email || ''
      };

      // 1. Save in DeleteHistory ledger
      const deleteRecord = new DeleteHistory({
        entityType,
        entityId,
        entityName: entityName || snapshot.name || snapshot.code || 'Record',
        deletedBy: actorInfo,
        deletionReason,
        recoveryStatus: 'Recoverable',
        snapshot
      });

      await deleteRecord.save();

      // 2. Also record in AuditLog
      await this.logAction({
        req,
        action: 'SOFT_DELETE',
        entityType,
        entityId,
        entityName: deleteRecord.entityName,
        details: {
          deletionReason,
          deleteHistoryId: deleteRecord._id
        }
      });

      return deleteRecord;
    } catch (err) {
      console.error('⚠️  Failed to record deletion history:', err.message);
      return null;
    }
  }

  /**
   * Record a restoration in DeleteHistory and AuditLog
   */
  async logRestoration({
    req,
    deleteHistoryRecord,
    entityType,
    entityId,
    entityName
  }) {
    try {
      const actorInfo = {
        userId: req?.user?._id,
        name: req?.user?.name || 'Administrator',
        email: req?.user?.email || ''
      };

      if (deleteHistoryRecord) {
        deleteHistoryRecord.recoveryStatus = 'Restored';
        deleteHistoryRecord.restoredAt = new Date();
        deleteHistoryRecord.restoredBy = actorInfo;
        await deleteHistoryRecord.save();
      }

      await this.logAction({
        req,
        action: 'RESTORE',
        entityType,
        entityId,
        entityName: entityName || deleteHistoryRecord?.entityName,
        details: {
          restoredFromDeleteHistoryId: deleteHistoryRecord?._id
        }
      });
    } catch (err) {
      console.error('⚠️  Failed to record restoration history:', err.message);
    }
  }

  /**
   * Record a permanent deletion in DeleteHistory and AuditLog
   */
  async logPermanentDeletion({
    req,
    deleteHistoryRecord,
    entityType,
    entityId,
    entityName
  }) {
    try {
      const actorInfo = {
        userId: req?.user?._id,
        name: req?.user?.name || 'Administrator',
        email: req?.user?.email || ''
      };

      if (deleteHistoryRecord) {
        deleteHistoryRecord.recoveryStatus = 'Permanently Deleted';
        deleteHistoryRecord.permanentlyDeletedAt = new Date();
        deleteHistoryRecord.permanentlyDeletedBy = actorInfo;
        await deleteHistoryRecord.save();
      }

      await this.logAction({
        req,
        action: 'PERMANENT_DELETE',
        entityType,
        entityId,
        entityName: entityName || deleteHistoryRecord?.entityName,
        details: {
          permanentPurgeDeleteHistoryId: deleteHistoryRecord?._id
        }
      });
    } catch (err) {
      console.error('⚠️  Failed to record permanent deletion history:', err.message);
    }
  }
}

module.exports = new AuditService();
