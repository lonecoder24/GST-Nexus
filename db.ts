
import Dexie, { Table } from 'dexie';
import { Taxpayer, Notice, PaymentLog, AuditLog, TeamTimeSheet, DocumentMeta, RiskLevel, NoticeStatus, User, Notification, AppConfig, UserRole, NoticeDefect, ReconciliationRecord, DEFAULT_ROLE_PERMISSIONS } from './types';

export class GSTDatabase extends Dexie {
  taxpayers!: Table<Taxpayer>;
  notices!: Table<Notice>;
  payments!: Table<PaymentLog>;
  auditLogs!: Table<AuditLog>;
  timeSheets!: Table<TeamTimeSheet>;
  documents!: Table<DocumentMeta>;
  users!: Table<User>;
  notifications!: Table<Notification>;
  appConfig!: Table<AppConfig>;
  defects!: Table<NoticeDefect>;
  reconciliations!: Table<ReconciliationRecord>;

  constructor() {
    super('GSTNexusDB');
    
    // Version 9: Added hearingDate to notices index
    (this as any).version(9).stores({
      taxpayers: '++id, &gstin, tradeName',
      notices: '++id, gstin, noticeNumber, arn, noticeType, status, dueDate, riskLevel, assignedTo, hearingDate',
      payments: '++id, noticeId, defectId, challanNumber, paymentDate, majorHead',
      auditLogs: '++id, entityId, timestamp, entityType',
      timeSheets: '++id, noticeId, teamMember',
      documents: '++id, noticeId, category',
      users: '++id, &username, role',
      notifications: '++id, userId, isRead, createdAt, link',
      appConfig: '++id, &key',
      defects: '++id, noticeId',
      reconciliations: '++id, gstin, noticeId, type, financialYear'
    });
  }
}

export const db = new GSTDatabase();

// Seed function for demo purposes
export const seedDatabase = async () => {
  const userCount = await db.users.count();
  if (userCount === 0) {
    // Default Admin: admin / admin123
    await db.users.add({
      username: 'admin',
      passwordHash: 'admin123', // Simple for demo
      fullName: 'System Administrator',
      role: UserRole.ADMIN,
      email: 'admin@gstnexus.com',
      isActive: true
    });
    
    // Default User
    await db.users.add({
        username: 'rahul_ca',
        passwordHash: 'user123',
        fullName: 'Rahul Associate',
        role: UserRole.ASSOCIATE,
        email: 'rahul@gstnexus.com',
        isActive: true
    });
  }

  // Seed App Config
  const configCount = await db.appConfig.count();
  if (configCount === 0) {
      await db.appConfig.add({
          key: 'notice_types',
          value: ['ASMT-10', 'DRC-01', 'DRC-07', 'SCN', 'Summons', 'Final Audit Report', 'Appeal Order']
      });
      await db.appConfig.add({
          key: 'notice_statuses',
          value: [
              NoticeStatus.RECEIVED, 
              NoticeStatus.ASSIGNED, 
              NoticeStatus.DRAFTING, 
              NoticeStatus.FILED, 
              NoticeStatus.HEARING, 
              NoticeStatus.CLOSED, 
              NoticeStatus.APPEAL
          ]
      });
      await db.appConfig.add({
          key: 'defect_types',
          value: [
            "ITC Mismatch (GSTR-3B vs GSTR-2A/2B)",
            "Short Payment (GSTR-3B vs GSTR-1)",
            "Ineligible ITC (Sec 17(5))",
            "RCM Liability (Sec 9(3)/9(4))",
            "Rule 86B Violation (1% Cash Payment)",
            "Wrong Place of Supply",
            "Fake Invoice / Bill Trading",
            "E-Way Bill Discrepancy",
            "Supplier Registration Cancelled",
            "Transitional Credit Issue",
            "Refund Rejection",
            "Others"
          ]
      });
      await db.appConfig.add({
        key: 'user_roles',
        value: [
            UserRole.ADMIN,
            UserRole.SENIOR_ASSOCIATE,
            UserRole.ASSOCIATE
        ]
    });
  }

  // Seed Permissions if they don't exist
  const permCount = await db.appConfig.where('key').startsWith('perm:').count();
  if (permCount === 0) {
      for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
          await db.appConfig.add({
              key: `perm:${role}`,
              value: perms
          });
      }
  }

  const count = await db.taxpayers.count();
  if (count === 0) {
    await db.taxpayers.add({
      gstin: '27ABCDE1234F1Z5',
      tradeName: 'Acme Traders Pvt Ltd',
      legalName: 'Acme Traders',
      mobile: '9876543210',
      email: 'accounts@acme.com',
      registeredAddress: '123 Market Road, Mumbai',
      stateCode: '27'
    });

    const noticeId = await db.notices.add({
      gstin: '27ABCDE1234F1Z5',
      arn: 'AD2704230001234',
      noticeNumber: 'DIN2023101055',
      noticeType: 'ASMT-10',
      section: 'Section 61',
      period: 'FY 2021-22',
      dateOfIssue: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0], // 3 days from now
      receivedDate: new Date().toISOString().split('T')[0],
      issuingAuthority: 'Sup. Range 5',
      demandAmount: 540000,
      riskLevel: RiskLevel.HIGH,
      status: NoticeStatus.RECEIVED,
      description: 'Discrepancy in GSTR-1 vs GSTR-3B',
      assignedTo: 'rahul_ca',
      tags: ['ITC Mismatch']
    });

    // Seed a defect for this notice with the new structure
    await db.defects.add({
        noticeId: noticeId,
        defectType: 'ITC Mismatch',
        section: 'Section 16(2)(c)',
        description: 'Mismatch between GSTR-3B and GSTR-2A',
        taxDemand: 500000,
        interestDemand: 40000,
        penaltyDemand: 0,
        igst: { tax: 250000, interest: 20000, penalty: 0, lateFee: 0, others: 0 },
        cgst: { tax: 125000, interest: 10000, penalty: 0, lateFee: 0, others: 0 },
        sgst: { tax: 125000, interest: 10000, penalty: 0, lateFee: 0, others: 0 },
        cess: { tax: 0, interest: 0, penalty: 0, lateFee: 0, others: 0 }
    });

    await db.auditLogs.add({
        entityType: 'System',
        entityId: 'INIT',
        action: 'Create',
        timestamp: new Date().toISOString(),
        user: 'System',
        details: 'Database seeded with sample data'
    });
  }
};

// Automated Notification Generator
export const checkAndGenerateNotifications = async () => {
    try {
        const today = new Date();
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(today.getDate() + 3);

        const activeNotices = await db.notices
            .where('status')
            .notEqual(NoticeStatus.CLOSED)
            .toArray();

        for (const notice of activeNotices) {
            const dueDate = new Date(notice.dueDate);
            let type: 'info' | 'warning' | 'critical' | null = null;
            let message = '';

            if (dueDate < today) {
                type = 'critical';
                message = `Overdue: Notice ${notice.noticeNumber} for ${notice.gstin} was due on ${notice.dueDate}`;
            } else if (dueDate <= threeDaysFromNow) {
                type = 'warning';
                message = `Due Soon: Notice ${notice.noticeNumber} is due in ${Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 3600 * 24))} days.`;
            }

            if (type) {
                const existing = await db.notifications
                    .where('link').equals(`/notices/${notice.id}`)
                    .and(n => {
                        const nDate = new Date(n.createdAt);
                        return nDate.getDate() === today.getDate() && nDate.getMonth() === today.getMonth();
                    })
                    .first();

                if (!existing) {
                    let userId: number | undefined = undefined;
                    if (notice.assignedTo) {
                        const user = await db.users.where('username').equals(notice.assignedTo).first();
                        userId = user?.id;
                    }

                    await db.notifications.add({
                        userId,
                        title: type === 'critical' ? 'Notice Overdue' : 'Approaching Deadline',
                        message,
                        type,
                        link: `/notices/${notice.id}`,
                        isRead: false,
                        createdAt: new Date().toISOString()
                    });
                }
            }
        }
    } catch (error) {
        console.error("Error generating notifications:", error);
    }
};