# `inspection-state-machine.ts` — the payment gate

Three edits. The transition table stays declarative, which is its strength.

## Edit 1 — a new refusal code

**Find:**
```ts
export type TransitionRefusal =
  | 'UNKNOWN_ACTION'
  | 'INVALID_STATE'
  | 'MISSING_PERMISSION'
  | 'NOT_ASSIGNEE'
  | 'SELF_REVIEW'
  | 'REASON_REQUIRED';
```

**Replace with:**
```ts
export type TransitionRefusal =
  | 'UNKNOWN_ACTION'
  | 'INVALID_STATE'
  | 'MISSING_PERMISSION'
  | 'NOT_ASSIGNEE'
  | 'SELF_REVIEW'
  | 'REASON_REQUIRED'
  | 'PAYMENT_REQUIRED';
```

## Edit 2 — a rule flag, so the requirement stays in the table

**Find:**
```ts
  /** A written reason is mandatory. */
  requiresReason?: boolean;
}
```

**Replace with:**
```ts
  /** A written reason is mandatory. */
  requiresReason?: boolean;
  /** The inspection fee must be settled before this action is permitted. */
  requiresSettledFee?: boolean;
}
```

**Find:**
```ts
  [InspectionAction.START]: {
    from: [InspectionStatus.ASSIGNED],
    to: InspectionStatus.IN_PROGRESS,
    permission: 'inspections.write',
    assigneeOnly: true,
  },
```

**Replace with:**
```ts
  [InspectionAction.START]: {
    from: [InspectionStatus.ASSIGNED],
    to: InspectionStatus.IN_PROGRESS,
    permission: 'inspections.write',
    assigneeOnly: true,
    // Fieldwork cannot begin until the inspection fee has been settled.
    // Declared here rather than in the service so there is still exactly one
    // place that answers "may this transition happen".
    requiresSettledFee: true,
  },
```

## Edit 3 — the context field and the check

**Find:**
```ts
  /** Who submitted the work; used to enforce separation of duties. */
  submittedById: string | null;
  reason?: string;
}
```

**Replace with:**
```ts
  /** Who submitted the work; used to enforce separation of duties. */
  submittedById: string | null;
  reason?: string;
  /**
   * Settlement state of the inspection fee, or null when no fee record
   * exists. Undefined is treated as "not settled" — a caller that forgets to
   * load it fails closed rather than open.
   */
  feeStatus?: FeeStatus | null;
}
```

Add to the imports at the top:

```ts
import { FeeStatus, InspectionStatus } from '@prisma/client';
```

**Find** — in `evaluateTransition`, after the `requiresReason` check:
```ts
  if (rule.requiresReason && !ctx.reason?.trim()) {
    return {
      allowed: false,
      code: 'REASON_REQUIRED',
      reason: 'A written reason is required for this action.',
    };
  }

  return { allowed: true, nextStatus: rule.to };
```

**Replace with:**
```ts
  if (rule.requiresReason && !ctx.reason?.trim()) {
    return {
      allowed: false,
      code: 'REASON_REQUIRED',
      reason: 'A written reason is required for this action.',
    };
  }

  // The fee gate. Note the shape of the test: anything other than an explicit
  // SUCCESSFUL refuses, so a missing fee record, a pending one, or a status
  // this code does not recognise all fail closed.
  if (rule.requiresSettledFee && ctx.feeStatus !== FeeStatus.SUCCESSFUL) {
    return {
      allowed: false,
      code: 'PAYMENT_REQUIRED',
      reason: 'The inspection fee has not been settled.',
    };
  }

  return { allowed: true, nextStatus: rule.to };
```

---

## Why the flag rather than a check in `start()`

Your comment at the top of this file says it well:

> Encoding the rules once, as a table, means there is exactly one place to
> answer "who may approve this, and from which state" — and no way for one
> endpoint to permit a move that another forbids.

Putting the fee check in `InspectionsService.start` would break that. If a
future endpoint ever transitions to IN_PROGRESS by another route, the table
still refuses it.
