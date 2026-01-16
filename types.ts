
export enum NoticeStatus {
  RECEIVED = 'Received',
  ASSIGNED = 'Assigned',
  DRAFTING = 'Drafting',
  FILED = 'Reply Filed',
  HEARING = 'Hearing Scheduled',
  CLOSED = 'Closed',
  APPEAL = 'Appeal'
}

export enum RiskLevel {
  LOW = 'Low',
  MEDIUM = 'Medium',
  HIGH = 'High',
  CRITICAL = 'Critical'
}

export enum HearingStatus {
  SCHEDULED = 'Scheduled',
  ADJOURNED = 'Adjourned',
  HEARD = 'Heard - Order Reserved',
  CONCLUDED = 'Concluded',
  CANCELLED = 'Cancelled'
}

export enum UserRole {
  ADMIN = 'Admin',
  SENIOR_ASSOCIATE = 'Senior Associate',
  ASSOCIATE = 'Associate'
}

export type PermissionType = 'view_notices' | 'create_notices' | 'edit_notices' | 'delete_notices' | 'manage_users' | 'export_data';

export const ALL_PERMISSIONS: PermissionType[] = [
  'view_notices', 
  'create_notices', 
  'edit_notices', 
  'delete_notices', 
  'manage_users', 
  'export_data'
];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionType[]> = {
  [UserRole.ADMIN]: ['view_notices', 'create_notices', 'edit_notices', 'delete_notices', 'manage_users', 'export_data'],
  [UserRole.SENIOR_ASSOCIATE]: ['view_notices', 'create_notices', 'edit_notices', 'export_data'],
  [UserRole.ASSOCIATE]: ['view_notices']
};

export interface User {
  id?: number;
  username: string;
  passwordHash: string; // In real app, use bcrypt. Here simple hash.
  fullName: string;
  role: string; // Changed from UserRole to allow dynamic configuration
  email: string;
  isActive: boolean;
}

export interface Notification {
  id?: number;
  userId?: number; // If null, system-wide
  title: string;
  message: string;
  type: 'info' | 'warning' | 'critical';
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface AppConfig {
  id?: number;
  key: string; // 'notice_types', 'notice_statuses', 'user_roles', 'perm:<role>', 'api_config'
  value: any; // Changed from string[] to any to support objects (like API config)
}

export interface Taxpayer {
  id?: number;
  gstin: string;
  tradeName: string;
  legalName: string;
  mobile: string;
  email: string;
  registeredAddress: string;
  stateCode: string;
}

export interface Notice {
  id?: number;
  gstin: string; // Foreign key to Taxpayer
  arn?: string; // Application Reference Number (Parent grouping)
  noticeNumber: string; // Specific Reference Number (DIN/Notice No)
  noticeType: string; // Configurable Dropdown (e.g., SCN, ASMT-10)
  section: string; // e.g., ASMT-10, DRC-01
  period: string; // FY 2022-23
  dateOfIssue: string; // ISO Date
  dueDate: string; // ISO Date
  extendedDueDate?: string;
  receivedDate: string;
  issuingAuthority: string; // Officer Name/Designation
  demandAmount: number; // Total cache
  riskLevel: RiskLevel;
  status: string; // Now a string to support configurable statuses
  description?: string;
  assignedTo?: string; // Team member name (username)
  tags?: string[];
  isOverdue?: boolean; // Computed
  
  // Legacy fields (kept for migration safety, but UI will use hearings table)
  hearingDate?: string;
  hearingTime?: string;
  hearingVenue?: string;
  hearingOutcome?: string;
}

export interface Hearing {
  id?: number;
  noticeId: number;
  date: string;
  time: string;
  venue: string;
  type: 'Personal Hearing' | 'Adjournment' | 'Final Hearing';
  attendees?: string; // Who attended (Staff/Client)
  status: HearingStatus;
  minutes?: string; // Outcome/Notes
}

export interface TaxHeadValues {
  tax: number;
  interest: number;
  penalty: number;
  lateFee: number;
  others: number;
}

export interface NoticeDefect {
  id?: number;
  noticeId: number;
  defectType: string; // e.g., 'ITC Mismatch', 'GSTR-3B vs 2A'
  section?: string; // Specific section for this defect
  description?: string;
  
  // Detailed Breakdown
  igst: TaxHeadValues;
  cgst: TaxHeadValues;
  sgst: TaxHeadValues;
  cess: TaxHeadValues;

  // Computed Totals (kept for backward compatibility and quick querying)
  taxDemand: number;
  interestDemand: number;
  penaltyDemand: number;
}

export type MajorTaxHead = 'IGST' | 'CGST' | 'SGST' | 'Cess';
export type MinorTaxHead = 'Tax' | 'Interest' | 'Penalty' | 'Late Fee' | 'Others' | 'Deposit';

export interface PaymentLog {
  id?: number;
  noticeId: number;
  defectId?: number; // Optional link to specific defect
  
  // New granular structure
  majorHead: MajorTaxHead;
  minorHead: MinorTaxHead;
  
  amount: number;
  challanNumber: string; // CIN/ARN
  paymentReferenceNumber?: string; // NEFT UTR, Cheque No
  cin?: string;
  paymentDate: string;
  bankName: string;
  notes?: string;
}

export interface AuditLog {
  id?: number;
  entityType: 'Notice' | 'Payment' | 'Taxpayer' | 'System' | 'Auth' | 'Defect' | 'Reconciliation' | 'Document' | 'Hearing' | 'Return' | 'TimeSheet';
  entityId: number | string;
  action: 'Create' | 'Update' | 'Delete' | 'StatusChange' | 'Login';
  timestamp: string;
  user: string;
  details: string; // JSON string of changes
}

export interface TeamTimeSheet {
  id?: number;
  noticeId: number;
  defectId?: number;
  teamMember: string;
  hoursSpent: number;
  date: string;
  description: string;
}

export interface DocumentMeta {
  id?: number;
  noticeId: number;
  fileName: string;
  fileType: string;
  category: 'Notice Scan' | 'Evidence' | 'Reconciliation' | 'Ledger' | 'Other';
  uploadDate: string;
  size: number;
  fileData?: Blob; // Storing the file content for offline access
  ocrText?: string; // Extracted text for searchability
}

// Reconciliation Worksheet Types
export interface ReconciliationRow {
  period: string; // "April", "May", "Q1", etc.
  sourceA: number; // e.g., GSTR-1 Value
  sourceB: number; // e.g., Books Value
  diff: number; // Computed or manual override
  remarks: string;
}

export interface ReconciliationRecord {
  id?: number;
  gstin: string;
  noticeId?: number; // Link to specific notice if applicable
  type: 'Turnover (GSTR-1 vs Books)' | 'Tax Liability (GSTR-3B vs Books)' | 'ITC (GSTR-2B vs Books)' | 'E-Way Bill vs GSTR-1' | 'Custom';
  financialYear: string;
  rows: ReconciliationRow[];
  updatedAt: string;
  lastModifiedBy: string;
}

// Returns & Analysis
export type GSTReturnType = 'GSTR-1' | 'GSTR-3B' | 'GSTR-9' | 'GSTR-2A' | 'GSTR-2B';

export interface ReturnRecord {
  id?: number;
  gstin: string;
  returnType: GSTReturnType;
  period: string; // MM-YYYY
  financialYear: string;
  filingDate: string;
  arn?: string;
  
  // Summary Values
  taxableValue: number;
  taxLiability: number; // For GSTR-1/3B
  itcAvailable: number; // For GSTR-2B/3B
  cashPaid: number;
  
  status: 'Filed' | 'Not Filed' | 'Submitted';
  sourceFile?: string; // Filename if imported
}
