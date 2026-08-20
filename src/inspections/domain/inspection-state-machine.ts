import { InspectionStatus } from '@prisma/client';

/**
 * The inspection lifecycle, expressed as data.
 *
 * Every transition in the system goes through `evaluateTransition`. Encoding
 * the rules once, as a table, means there is exactly one place to answer "who
 * may approve this, and from which state" — and no way for one endpoint to
 * permit a move that another forbids.
 */

export enum InspectionAction {
  ASSIGN = 'ASSIGN',
  REASSIGN = 'REASSIGN',
  START = 'START',
  SUBMIT = 'SUBMIT',
  BEGIN_REVIEW = 'BEGIN_REVIEW',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  REQUEST_CORRECTION = 'REQUEST_CORRECTION',
  RESUBMIT = 'RESUBMIT',
  GENERATE_REPORT = 'GENERATE_REPORT',
  ARCHIVE = 'ARCHIVE',
}

interface TransitionRule {
  from: InspectionStatus[];
  to: InspectionStatus;
  permission: string;
  /** Only the inspector the work is assigned to may act. */
  assigneeOnly?: boolean;
  /** The person who submitted may not also decide on it. */
  forbidSelfReview?: boolean;
  /** A written reason is mandatory. */
  requiresReason?: boolean;
}

export const TRANSITIONS: Record<InspectionAction, TransitionRule> = {
  [InspectionAction.ASSIGN]: {
    from: [InspectionStatus.ASSIGNED],
    to: InspectionStatus.ASSIGNED,
    permission: 'inspections.assign',
  },
  [InspectionAction.REASSIGN]: {
    // Allowed while work is under way — an inspector may fall ill — but never
    // after submission, which would detach submitted work from the person who
    // attested to it.
    from: [
      InspectionStatus.ASSIGNED,
      InspectionStatus.IN_PROGRESS,
      InspectionStatus.CORRECTION_REQUESTED,
    ],
    to: InspectionStatus.ASSIGNED,
    permission: 'inspections.assign',
    requiresReason: true,
  },
  [InspectionAction.START]: {
    from: [InspectionStatus.ASSIGNED],
    to: InspectionStatus.IN_PROGRESS,
    permission: 'inspections.write',
    assigneeOnly: true,
  },
  [InspectionAction.SUBMIT]: {
    from: [InspectionStatus.IN_PROGRESS],
    to: InspectionStatus.SUBMITTED,
    permission: 'inspections.write',
    assigneeOnly: true,
  },
  [InspectionAction.BEGIN_REVIEW]: {
    from: [InspectionStatus.SUBMITTED, InspectionStatus.RESUBMITTED],
    to: InspectionStatus.UNDER_REVIEW,
    permission: 'reviews.decide',
    forbidSelfReview: true,
  },
  [InspectionAction.APPROVE]: {
    from: [InspectionStatus.SUBMITTED, InspectionStatus.RESUBMITTED, InspectionStatus.UNDER_REVIEW],
    to: InspectionStatus.APPROVED,
    permission: 'reviews.decide',
    forbidSelfReview: true,
  },
  [InspectionAction.REJECT]: {
    from: [InspectionStatus.SUBMITTED, InspectionStatus.RESUBMITTED, InspectionStatus.UNDER_REVIEW],
    to: InspectionStatus.REJECTED,
    permission: 'reviews.decide',
    forbidSelfReview: true,
    requiresReason: true,
  },
  [InspectionAction.REQUEST_CORRECTION]: {
    from: [InspectionStatus.SUBMITTED, InspectionStatus.RESUBMITTED, InspectionStatus.UNDER_REVIEW],
    to: InspectionStatus.CORRECTION_REQUESTED,
    permission: 'reviews.decide',
    forbidSelfReview: true,
    requiresReason: true,
  },
  [InspectionAction.RESUBMIT]: {
    from: [InspectionStatus.CORRECTION_REQUESTED],
    to: InspectionStatus.RESUBMITTED,
    permission: 'inspections.write',
    assigneeOnly: true,
  },
  [InspectionAction.GENERATE_REPORT]: {
    // Only an approved inspection yields an official report; generating one
    // from unapproved data would create a document nobody sanctioned.
    from: [InspectionStatus.APPROVED, InspectionStatus.REPORT_GENERATED],
    to: InspectionStatus.REPORT_GENERATED,
    permission: 'reports.generate',
  },
  [InspectionAction.ARCHIVE]: {
    from: [InspectionStatus.REPORT_GENERATED, InspectionStatus.REJECTED],
    to: InspectionStatus.ARCHIVED,
    permission: 'inspections.archive',
  },
};

export interface TransitionContext {
  action: InspectionAction;
  currentStatus: InspectionStatus;
  userId: string;
  permissions: ReadonlySet<string>;
  inspectorId: string | null;
  /** Who submitted the work; used to enforce separation of duties. */
  submittedById: string | null;
  reason?: string;
}

export type TransitionRefusal =
  | 'UNKNOWN_ACTION'
  | 'INVALID_STATE'
  | 'MISSING_PERMISSION'
  | 'NOT_ASSIGNEE'
  | 'SELF_REVIEW'
  | 'REASON_REQUIRED';

export type TransitionOutcome =
  | { allowed: true; nextStatus: InspectionStatus }
  | { allowed: false; code: TransitionRefusal; reason: string };

export function evaluateTransition(ctx: TransitionContext): TransitionOutcome {
  const rule = TRANSITIONS[ctx.action];

  if (!rule) {
    return { allowed: false, code: 'UNKNOWN_ACTION', reason: `Unknown action "${String(ctx.action)}".` };
  }

  if (!rule.from.includes(ctx.currentStatus)) {
    return {
      allowed: false,
      code: 'INVALID_STATE',
      reason: `An inspection that is ${humaniseStatus(ctx.currentStatus).toLowerCase()} cannot be ${describeAction(ctx.action)}.`,
    };
  }

  if (!ctx.permissions.has(rule.permission)) {
    return {
      allowed: false,
      code: 'MISSING_PERMISSION',
      reason: 'You do not have permission to perform this action.',
    };
  }

  if (rule.assigneeOnly && ctx.inspectorId !== ctx.userId) {
    return {
      allowed: false,
      code: 'NOT_ASSIGNEE',
      reason: 'Only the assigned inspector can perform this action.',
    };
  }

  // Separation of duties. The person who carried out and attested to the work
  // must not be the one who signs it off. This single rule is what gives the
  // audit trail meaning; without it the record shows only that somebody agreed
  // with themselves.
  if (rule.forbidSelfReview && ctx.submittedById && ctx.submittedById === ctx.userId) {
    return {
      allowed: false,
      code: 'SELF_REVIEW',
      reason: 'You cannot review an inspection that you submitted yourself.',
    };
  }

  if (rule.requiresReason && !ctx.reason?.trim()) {
    return {
      allowed: false,
      code: 'REASON_REQUIRED',
      reason: 'A written reason is required for this action.',
    };
  }

  return { allowed: true, nextStatus: rule.to };
}

/** Statuses in which the inspector may still edit content. */
export const EDITABLE_STATUSES: InspectionStatus[] = [
  InspectionStatus.IN_PROGRESS,
  InspectionStatus.CORRECTION_REQUESTED,
];

/** Statuses representing work still owed by somebody. */
export const OPEN_STATUSES: InspectionStatus[] = [
  InspectionStatus.ASSIGNED,
  InspectionStatus.IN_PROGRESS,
  InspectionStatus.SUBMITTED,
  InspectionStatus.UNDER_REVIEW,
  InspectionStatus.CORRECTION_REQUESTED,
  InspectionStatus.RESUBMITTED,
];

/** Statuses awaiting a reviewer decision. */
export const REVIEW_QUEUE_STATUSES: InspectionStatus[] = [
  InspectionStatus.SUBMITTED,
  InspectionStatus.RESUBMITTED,
  InspectionStatus.UNDER_REVIEW,
];

export function isEditable(status: InspectionStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export function humaniseStatus(status: InspectionStatus): string {
  const labels: Record<InspectionStatus, string> = {
    ASSIGNED: 'Assigned',
    IN_PROGRESS: 'In progress',
    SUBMITTED: 'Submitted',
    UNDER_REVIEW: 'Under review',
    CORRECTION_REQUESTED: 'Correction requested',
    RESUBMITTED: 'Resubmitted',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    REPORT_GENERATED: 'Report generated',
    ARCHIVED: 'Archived',
  };
  return labels[status] ?? status;
}

function describeAction(action: InspectionAction): string {
  const labels: Record<InspectionAction, string> = {
    ASSIGN: 'assigned',
    REASSIGN: 'reassigned',
    START: 'started',
    SUBMIT: 'submitted',
    BEGIN_REVIEW: 'moved into review',
    APPROVE: 'approved',
    REJECT: 'rejected',
    REQUEST_CORRECTION: 'returned for correction',
    RESUBMIT: 'resubmitted',
    GENERATE_REPORT: 'used to generate a report',
    ARCHIVE: 'archived',
  };
  return labels[action] ?? 'changed';
}
