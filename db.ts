
import Dexie, { Table } from 'dexie';
import { Taxpayer, Notice, PaymentLog, AuditLog, TeamTimeSheet, DocumentMeta, RiskLevel, NoticeStatus, User, Notification, AppConfig, UserRole, NoticeDefect, ReconciliationRecord, DEFAULT_ROLE_PERMISSIONS, Hearing, ReturnRecord, Invoice } from './types';

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
  hearings!: Table<Hearing>;
  returns!: Table<ReturnRecord>;
  invoices!: Table<Invoice>;

  constructor() {
    super('GSTNexusDB');
    
    // Version 14: Added caseType to notices
    (this as any).version(14).stores({
      taxpayers: '++id, &gstin, tradeName',
      notices: '++id, gstin, noticeNumber, arn, noticeType, caseType, status, dueDate, riskLevel, assignedTo, hearingDate, lastCheckedDate',
      payments: '++id, noticeId, defectId, challanNumber, paymentDate, majorHead',
      auditLogs: '++id, entityId, timestamp, entityType',
      timeSheets: '++id, noticeId, teamMember, date',
      documents: '++id, noticeId, category',
      users: '++id, &username, role',
      notifications: '++id, userId, isRead, createdAt, link',
      appConfig: '++id, &key',
      defects: '++id, noticeId',
      reconciliations: '++id, gstin, noticeId, type, financialYear',
      hearings: '++id, noticeId, date, status',
      returns: '++id, gstin, returnType, period, financialYear',
      invoices: '++id, invoiceNumber, gstin, date, status'
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
  }

  // Seed App Config
  const configCount = await db.appConfig.count();
  if (configCount === 0) {
      await db.appConfig.add({
          key: 'notice_types',
          value: ['ASMT-10', 'DRC-01', 'DRC-07', 'SCN', 'Summons', 'Final Audit Report', 'Appeal Order', 'Rectification Order']
      });
      // New Case Tracks
      await db.appConfig.add({
          key: 'case_types',
          value: [
              'Assessment Proceedings (ASMT)',
              'Demand & Recovery (DRC)',
              'Rectification',
              'Appeal',
              'Refund',
              'Investigation / Summons',
              'General'
          ]
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
              NoticeStatus.APPEAL,
              'Order Passed'
          ]
      });
      // New: Configure which statuses stop the overdue timer
      await db.appConfig.add({
          key: 'overdue_excluded_statuses',
          value: [
              NoticeStatus.CLOSED,
              NoticeStatus.FILED,
              NoticeStatus.APPEAL,
              'Order Passed'
          ]
      });
      await db.appConfig.add({
          key: 'notice_periods',
          value: [
              'FY 2017-18', 
              'FY 2018-19', 
              'FY 2019-20', 
              'FY 2020-21', 
              'FY 2021-22', 
              'FY 2022-23', 
              'FY 2023-24', 
              'FY 2024-25'
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
    // Default Notification Settings
    await db.appConfig.add({
        key: 'notification_reminder_days',
        value: 3
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
};

// Automated Notification Generator
export const checkAndGenerateNotifications = async () => {
    try {
        const today = new Date();
        
        // Fetch dynamic configuration
        const config = await db.appConfig.get({ key: 'notification_reminder_days' });
        const reminderDays = config && config.value ? Number(config.value) : 3;

        // Fetch configured resolved statuses (statuses that STOP overdue counter)
        const statusConfig = await db.appConfig.get({ key: 'overdue_excluded_statuses' });
        const resolvedStatuses = statusConfig ? statusConfig.value : [NoticeStatus.CLOSED, NoticeStatus.FILED, NoticeStatus.APPEAL, 'Order Passed'];

        const targetDate = new Date();
        targetDate.setDate(today.getDate() + reminderDays);

        // Get only active notices (status is NOT in resolved list)
        const activeNotices = await db.notices
            .filter(n => !resolvedStatuses.includes(n.status as any))
            .toArray();

        for (const notice of activeNotices) {
            let userId: number | undefined = undefined;
            if (notice.assignedTo) {
                const user = await db.users.where('username').equals(notice.assignedTo).first();
                userId = user?.id;
            }

            // 1. Due Date Checks
            const dueDate = new Date(notice.dueDate);
            let type: 'info' | 'warning' | 'critical' | null = null;
            let message = '';
            let title = '';

            if (dueDate < today) {
                type = 'critical';
                title = 'Notice Overdue';
                message = `Overdue: Notice ${notice.noticeNumber} was due on ${notice.dueDate}`;
            } else if (dueDate <= targetDate) {
                type = 'warning';
                title = 'Approaching Deadline';
                message = `Due Soon: Notice ${notice.noticeNumber} is due in ${Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 3600 * 24))} days.`;
            }

            if (type) {
                const existing = await db.notifications
                    .where('link').equals(`/notices/${notice.id}`)
                    .and(n => n.title === title && !n.isRead)
                    .first();

                if (!existing) {
                    await db.notifications.add({
                        userId,
                        title,
                        message,
                        type,
                        link: `/notices/${notice.id}`,
                        isRead: false,
                        createdAt: new Date().toISOString()
                    });
                }
            }

            // 2. SLA Breach Check (Last Checked Date > 7 Days)
            if (notice.lastCheckedDate) {
                const lastChecked = new Date(notice.lastCheckedDate);
                const diffTime = Math.abs(today.getTime() - lastChecked.getTime());
                const daysSinceCheck = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                const SLA_THRESHOLD = 7;

                if (daysSinceCheck > SLA_THRESHOLD) {
                    const slaTitle = 'SLA Breach: Review Overdue';
                    const existingSla = await db.notifications
                        .where('link').equals(`/notices/${notice.id}`)
                        .and(n => n.title === slaTitle && !n.isRead)
                        .first();

                    if (!existingSla) {
                        await db.notifications.add({
                            userId,
                            title: slaTitle,
                            message: `Notice ${notice.noticeNumber} hasn't been reviewed for ${daysSinceCheck} days (SLA: 7 days).`,
                            type: 'warning',
                            link: `/notices/${notice.id}`,
                            isRead: false,
                            createdAt: new Date().toISOString()
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error generating notifications:", error);
    }
};
