
import Dexie, { Table } from 'dexie';
import { Taxpayer, Notice, PaymentLog, AuditLog, TeamTimeSheet, DocumentMeta, RiskLevel, NoticeStatus, User, Notification, AppConfig, UserRole, NoticeDefect, ReconciliationRecord, DEFAULT_ROLE_PERMISSIONS, Hearing, ReturnRecord, Invoice, InvoiceStatus, HearingStatus } from './types';

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
    
    (this as any).version(16).stores({
      taxpayers: '++id, &gstin, tradeName',
      notices: '++id, gstin, noticeNumber, arn, noticeType, caseType, status, dueDate, riskLevel, assignedTo, hearingDate, lastCheckedDate, linkedCaseId, budgetedHours',
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

const ORDER_TYPES = ['DRC-07', 'DRC-08', 'ASMT-13', 'ASMT-15', 'Appeal Order', 'Rectification Order', 'Order Passed'];
const CONTESTED_STATUSES = ['Appeal Filed', 'Rectification Filed', 'Closed', 'Paid'];

export const seedDatabase = async () => {
  const userCount = await db.users.count();
  if (userCount === 0) {
    await db.users.add({
      username: 'admin',
      passwordHash: 'admin123',
      fullName: 'System Administrator',
      role: UserRole.ADMIN,
      email: 'admin@gstnexus.com',
      isActive: true
    });
  }

  const configCount = await db.appConfig.count();
  if (configCount === 0) {
      await db.appConfig.add({
          key: 'notice_types',
          value: ['ASMT-10', 'DRC-01', 'DRC-07', 'DRC-08', 'ASMT-13', 'SCN', 'Summons', 'Final Audit Report', 'Appeal Order', 'Rectification Order']
      });
      await db.appConfig.add({
          key: 'case_types',
          value: ['Assessment Proceedings (ASMT)', 'Demand & Recovery (DRC)', 'Rectification', 'Appeal', 'Refund', 'Investigation / Summons', 'General']
      });
      await db.appConfig.add({
          key: 'notice_statuses',
          value: [NoticeStatus.RECEIVED, NoticeStatus.ASSIGNED, NoticeStatus.DRAFTING, NoticeStatus.FILED, NoticeStatus.HEARING, NoticeStatus.CLOSED, NoticeStatus.APPEAL, 'Appeal Filed', 'Rectification Filed', 'Order Passed']
      });
      await db.appConfig.add({
          key: 'overdue_excluded_statuses',
          value: [NoticeStatus.CLOSED, NoticeStatus.FILED, NoticeStatus.APPEAL, 'Order Passed', 'Appeal Filed', 'Rectification Filed']
      });
      await db.appConfig.add({
          key: 'notice_periods',
          value: ['FY 2017-18', 'FY 2018-19', 'FY 2019-20', 'FY 2020-21', 'FY 2021-22', 'FY 2022-23', 'FY 2023-24', 'FY 2024-25']
      });
      await db.appConfig.add({
          key: 'defect_types',
          value: ["ITC Mismatch (GSTR-3B vs GSTR-2A/2B)", "Short Payment (GSTR-3B vs GSTR-1)", "Ineligible ITC (Sec 17(5))", "RCM Liability (Sec 9(3)/9(4))", "Rule 86B Violation (1% Cash Payment)", "Wrong Place of Supply", "Fake Invoice / Bill Trading", "E-Way Bill Discrepancy", "Supplier Registration Cancelled", "Transitional Credit Issue", "Refund Rejection", "Others"]
      });
      await db.appConfig.add({ key: 'user_roles', value: [UserRole.ADMIN, UserRole.SENIOR_ASSOCIATE, UserRole.ASSOCIATE] });
      await db.appConfig.add({ key: 'notification_reminder_days', value: 3 });
  }

  const permCount = await db.appConfig.where('key').startsWith('perm:').count();
  if (permCount === 0) {
      for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
          await db.appConfig.add({ key: `perm:${role}`, value: perms });
      }
  }
};

export const checkAndGenerateNotifications = async () => {
    try {
        const today = new Date();
        const config = await db.appConfig.get({ key: 'notification_reminder_days' });
        const reminderDays = config && config.value ? Number(config.value) : 3;

        const statusConfig = await db.appConfig.get({ key: 'overdue_excluded_statuses' });
        const resolvedStatuses = statusConfig ? statusConfig.value : [NoticeStatus.CLOSED, NoticeStatus.FILED, NoticeStatus.APPEAL, 'Order Passed'];

        const targetDate = new Date();
        targetDate.setDate(today.getDate() + reminderDays);

        const activeNotices = await db.notices
            .filter(n => !resolvedStatuses.includes(n.status as any))
            .toArray();

        for (const notice of activeNotices) {
            let userId: number | undefined = undefined;
            if (notice.assignedTo) {
                const user = await db.users.where('username').equals(notice.assignedTo).first();
                userId = user?.id;
            }

            // 1. Due Date Checks (Standard)
            const dueDate = new Date(notice.dueDate);
            if (dueDate < today) {
                await addNotification(userId, 'Notice Overdue', `Overdue: Notice ${notice.noticeNumber} was due on ${notice.dueDate}`, 'critical', `/notices/${notice.id}`);
            } else if (dueDate <= targetDate) {
                await addNotification(userId, 'Approaching Deadline', `Due Soon: Notice ${notice.noticeNumber} is due in ${Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 3600 * 24))} days.`, 'warning', `/notices/${notice.id}`);
            }

            // 2. Order Contest Tracker (90 Days Logic)
            if (ORDER_TYPES.includes(notice.noticeType) && !CONTESTED_STATUSES.includes(notice.status)) {
                const issueDate = new Date(notice.dateOfIssue);
                const contestDeadline = new Date(issueDate);
                contestDeadline.setDate(issueDate.getDate() + 90);

                const daysRemaining = Math.ceil((contestDeadline.getTime() - today.getTime()) / (1000 * 3600 * 24));

                if (daysRemaining <= 0) {
                    await addNotification(userId, 'Order Contest Expired!', `Contest period for Order ${notice.noticeNumber} ended on ${contestDeadline.toLocaleDateString()}.`, 'critical', `/notices/${notice.id}`);
                } else if (daysRemaining <= 15) {
                    await addNotification(userId, 'CRITICAL: Appeal Deadline', `Only ${daysRemaining} days left to contest Order ${notice.noticeNumber}.`, 'critical', `/notices/${notice.id}`);
                } else if (daysRemaining <= 30) {
                    await addNotification(userId, 'Order Contest Warning', `${daysRemaining} days remaining to file Appeal/Rectification for Order ${notice.noticeNumber}.`, 'warning', `/notices/${notice.id}`);
                }
            }

            // 3. SLA Breach Check
            if (notice.lastCheckedDate) {
                const lastChecked = new Date(notice.lastCheckedDate);
                const daysSinceCheck = Math.floor(Math.abs(today.getTime() - lastChecked.getTime()) / (1000 * 60 * 60 * 24));
                if (daysSinceCheck > 7) {
                    await addNotification(userId, 'SLA Breach: Review Overdue', `Notice ${notice.noticeNumber} hasn't been reviewed for ${daysSinceCheck} days.`, 'warning', `/notices/${notice.id}`);
                }
            }
        }
    } catch (error) {
        console.error("Error generating notifications:", error);
    }
};

async function addNotification(userId: number | undefined, title: string, message: string, type: 'info' | 'warning' | 'critical', link: string) {
    const existing = await db.notifications
        .where('link').equals(link)
        .and(n => n.title === title && !n.isRead)
        .first();

    if (!existing) {
        await db.notifications.add({
            userId, title, message, type, link, isRead: false, createdAt: new Date().toISOString()
        });
    }
}
