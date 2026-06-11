import { z } from 'zod';
import type { FieldConfig, FormConfig } from '../config/forms.js';

export interface ValidationResult {
  ok: boolean;
  data: Record<string, string>;
  errors: Record<string, string>;
}

function schemaForField(field: FieldConfig) {
  let s = z.string().trim();

  switch (field.type) {
    case 'email':
      s = s.email('Invalid email address');
      break;
    case 'phone':
      s = s.regex(/^[\d\s()+.\-]{5,40}$/, 'Invalid phone number');
      break;
    case 'number':
      s = s.regex(/^-?\d+([.,]\d+)?$/, 'Must be a number');
      break;
    default:
      break;
  }

  if (field.maxLength) s = s.max(field.maxLength, `Max ${field.maxLength} characters`);

  return field.required
    ? s.min(1, 'Required')
    : s.optional().or(z.literal(''));
}

/**
 * Validates a raw submission against the form's declared fields.
 * Unknown fields are dropped — only declared fields are ever forwarded.
 */
export function validateSubmission(
  form: FormConfig,
  raw: Record<string, unknown>
): ValidationResult {
  const data: Record<string, string> = {};
  const errors: Record<string, string> = {};

  for (const field of form.fields) {
    const value = typeof raw[field.name] === 'string' ? (raw[field.name] as string) : '';
    const result = schemaForField(field).safeParse(value);

    if (!result.success) {
      errors[field.name] = result.error.issues[0]?.message ?? 'Invalid value';
    } else if (typeof result.data === 'string' && result.data !== '') {
      data[field.name] = result.data;
    }
  }

  return { ok: Object.keys(errors).length === 0, data, errors };
}

/** Interpolates {{field}} placeholders in subject templates. */
export function renderSubject(template: string, data: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => data[key] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
