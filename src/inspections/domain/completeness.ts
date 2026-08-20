import { FieldType, PhotoCategory } from '@prisma/client';

/**
 * Template-driven completeness checking.
 *
 * The mobile app runs the same rules to drive its progress indicator, but the
 * server's verdict is the only one that governs submission. Client validation
 * is a convenience, not a control: a modified client can skip it.
 */

export interface FieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface FieldDefinition {
  id: string;
  code: string;
  label: string;
  type: FieldType;
  required: boolean;
  validation?: FieldValidation | null;
}

export interface SectionDefinition {
  code: string;
  name: string;
  isAssessment: boolean;
  fields: FieldDefinition[];
}

export interface PhotoRuleDefinition {
  category: PhotoCategory;
  minCount: number;
  required: boolean;
}

export interface SubmittedValue {
  fieldId: string;
  valueText?: string | null;
  valueNumber?: number | null;
  valueDate?: Date | null;
  valueBool?: boolean | null;
  valueJson?: unknown;
}

export interface AssessmentState {
  categoryCode: string;
  categoryName: string;
  rating: number | null;
  condition: string | null;
}

export interface CompletenessInput {
  sections: SectionDefinition[];
  photoRules: PhotoRuleDefinition[];
  values: SubmittedValue[];
  assessments: AssessmentState[];
  photoCountsByCategory: Record<string, number>;
  hasOwner: boolean;
  hasValuation: boolean;
  hasLocation: boolean;
}

export interface CompletenessIssue {
  /** Machine-readable, so the app can deep-link to the offending step. */
  code: string;
  sectionCode?: string;
  fieldCode?: string;
  message: string;
  blocking: boolean;
}

export interface CompletenessResult {
  complete: boolean;
  percentage: number;
  issues: CompletenessIssue[];
  blockingIssues: CompletenessIssue[];
}

function hasValue(value: SubmittedValue | undefined): boolean {
  if (!value) return false;
  if (typeof value.valueText === 'string' && value.valueText.trim() !== '') return true;
  if (value.valueNumber !== undefined && value.valueNumber !== null) return true;
  if (value.valueDate !== undefined && value.valueDate !== null) return true;
  // false is a legitimate answer to a boolean question; only null is unanswered.
  if (value.valueBool !== undefined && value.valueBool !== null) return true;
  if (value.valueJson !== undefined && value.valueJson !== null) {
    if (Array.isArray(value.valueJson)) return value.valueJson.length > 0;
    return true;
  }
  return false;
}

function validateFieldValue(
  field: FieldDefinition,
  value: SubmittedValue,
  sectionCode: string,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  const rules = field.validation;
  if (!rules) return issues;

  if (typeof value.valueNumber === 'number') {
    if (rules.min !== undefined && value.valueNumber < rules.min) {
      issues.push({
        code: 'VALUE_BELOW_MIN',
        sectionCode,
        fieldCode: field.code,
        message: `${field.label} must be at least ${rules.min}.`,
        blocking: true,
      });
    }
    if (rules.max !== undefined && value.valueNumber > rules.max) {
      issues.push({
        code: 'VALUE_ABOVE_MAX',
        sectionCode,
        fieldCode: field.code,
        message: `${field.label} must be no more than ${rules.max}.`,
        blocking: true,
      });
    }
  }

  const text = value.valueText;
  if (typeof text === 'string' && text.length > 0) {
    if (rules.minLength !== undefined && text.length < rules.minLength) {
      issues.push({
        code: 'TEXT_TOO_SHORT',
        sectionCode,
        fieldCode: field.code,
        message: `${field.label} must be at least ${rules.minLength} characters.`,
        blocking: true,
      });
    }
    if (rules.maxLength !== undefined && text.length > rules.maxLength) {
      issues.push({
        code: 'TEXT_TOO_LONG',
        sectionCode,
        fieldCode: field.code,
        message: `${field.label} must be no more than ${rules.maxLength} characters.`,
        blocking: true,
      });
    }
    if (rules.pattern) {
      let matches = true;
      try {
        matches = new RegExp(rules.pattern).test(text);
      } catch {
        // A malformed pattern is a template configuration fault. Treating it as
        // a pass avoids blocking an inspector for somebody else's typo; the
        // template editor is where that should surface.
        matches = true;
      }
      if (!matches) {
        issues.push({
          code: 'PATTERN_MISMATCH',
          sectionCode,
          fieldCode: field.code,
          message: `${field.label} is not in the expected format.`,
          blocking: true,
        });
      }
    }
  }

  return issues;
}

/**
 * Evaluates whether an inspection is fit to submit, and how far along it is.
 *
 * Percentage weights every requirement equally. It is a progress indicator for
 * the inspector, not a quality score for the property.
 */
export function evaluateCompleteness(input: CompletenessInput): CompletenessResult {
  const issues: CompletenessIssue[] = [];
  const valuesByField = new Map(input.values.map((v) => [v.fieldId, v]));

  let satisfied = 0;
  let total = 0;

  for (const section of input.sections) {
    for (const field of section.fields) {
      const value = valuesByField.get(field.id);

      if (field.required) {
        total += 1;
        if (hasValue(value)) satisfied += 1;
        else {
          issues.push({
            code: 'REQUIRED_FIELD_MISSING',
            sectionCode: section.code,
            fieldCode: field.code,
            message: `${field.label} is required.`,
            blocking: true,
          });
        }
      }

      if (value && hasValue(value)) {
        issues.push(...validateFieldValue(field, value, section.code));
      }
    }
  }

  for (const assessment of input.assessments) {
    total += 1;
    if (assessment.rating !== null && assessment.rating !== undefined) satisfied += 1;
    else {
      issues.push({
        code: 'ASSESSMENT_NOT_RATED',
        sectionCode: assessment.categoryCode,
        message: `${assessment.categoryName} has not been rated.`,
        blocking: true,
      });
    }
  }

  for (const rule of input.photoRules) {
    if (!rule.required) continue;
    total += 1;
    const count = input.photoCountsByCategory[rule.category] ?? 0;
    if (count >= rule.minCount) satisfied += 1;
    else {
      issues.push({
        code: 'PHOTO_REQUIREMENT_UNMET',
        sectionCode: 'PHOTOS',
        message: `${describePhotoCategory(rule.category)} requires ${rule.minCount} photograph(s); ${count} provided.`,
        blocking: true,
      });
    }
  }

  total += 1;
  if (input.hasOwner) satisfied += 1;
  else {
    issues.push({
      code: 'OWNER_MISSING',
      sectionCode: 'OWNER',
      message: 'Owner information has not been recorded.',
      blocking: true,
    });
  }

  total += 1;
  if (input.hasValuation) satisfied += 1;
  else {
    issues.push({
      code: 'VALUATION_MISSING',
      sectionCode: 'VALUATION',
      message: 'Valuation has not been recorded.',
      blocking: true,
    });
  }

  total += 1;
  if (input.hasLocation) satisfied += 1;
  else {
    // Blocking: an inspection with no location capture offers no evidence that
    // anyone visited the property, which is the point of the exercise.
    issues.push({
      code: 'LOCATION_MISSING',
      sectionCode: 'LOCATION',
      message: 'GPS location has not been captured at the property.',
      blocking: true,
    });
  }

  const blockingIssues = issues.filter((i) => i.blocking);

  return {
    complete: blockingIssues.length === 0,
    percentage: total === 0 ? 100 : Math.round((satisfied / total) * 100),
    issues,
    blockingIssues,
  };
}

export function describePhotoCategory(category: PhotoCategory | string): string {
  const labels: Record<string, string> = {
    FRONT_VIEW: 'Front view',
    REAR_VIEW: 'Rear view',
    LEFT_SIDE: 'Left side',
    RIGHT_SIDE: 'Right side',
    INTERIOR: 'Interior',
    ROOF: 'Roof',
    FOUNDATION: 'Foundation',
    ROAD_ACCESS: 'Road access',
    UTILITIES: 'Utilities',
    SURROUNDINGS: 'Surroundings',
    DOCUMENT: 'Document',
    OTHER: 'Other',
  };
  return labels[category] ?? String(category);
}
