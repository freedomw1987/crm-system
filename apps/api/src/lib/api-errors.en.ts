import type { ApiErrorMessages } from './api-errors';

/**
 * English error catalog (canonical source of truth — every other
 * locale mirrors this shape, with translated values).
 *
 * Convention: keys are SCREAMING_SNAKE_CASE grouped by domain.
 * Values are short, user-facing sentences ending in a period
 * (matches the existing inline strings the route files were
 * returning before i18n).
 *
 * If you add a key here, you MUST also add it to:
 *   - `api-errors.zh-TW.ts`
 *   - `api-errors.zh-CN.ts`
 *   - `ApiErrorMessages` interface in `api-errors.ts`
 * TypeScript will fail at build time if any are missing.
 */
export const apiErrorsEn: ApiErrorMessages = {
  // ============ Global / generic ============
  NOT_FOUND: 'Not found',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: "Forbidden: missing permission '{{permission}}'",
  FORBIDDEN_ANY: "Forbidden: need one of [{{permissions}}]",
  INTERNAL_ERROR: 'Internal server error',
  VALIDATION_FAILED: 'Validation failed',
  INVALID_INPUT: 'Invalid input',

  // ============ Auth ============
  INVALID_CREDENTIALS: 'Invalid credentials',
  INVALID_TOKEN: 'Invalid token',
  EMAIL_ALREADY_REGISTERED: 'Email already registered',
  CURRENT_PASSWORD_WRONG: 'Current password is wrong',
  // Password policy strings (lib/password-policy.ts)
  PASSWORD_TOO_SHORT: 'Password must be at least 12 characters',
  PASSWORD_NEEDS_DIGIT: 'Password must contain at least one digit',
  PASSWORD_NEEDS_SPECIAL: 'Password must contain at least one special character',

  // ============ User management ============
  USER_NOT_FOUND: 'User not found',
  EMAIL_ALREADY_EXISTS: 'Email already exists',
  INVALID_ROLE: 'Invalid role',
  CANNOT_DEACTIVATE_SELF: 'Cannot deactivate your own account',
  CANNOT_DELETE_SELF: 'Cannot delete your own account',
  CANNOT_DEMOTE_LAST_ADMIN: 'Cannot demote the last admin',
  CANNOT_DELETE_LAST_ADMIN: 'Cannot delete the last admin',

  // ============ Preferences (i18n) ============
  INVALID_LOCALE: 'Invalid locale. Supported: en, zh-TW, zh-CN',
  PREFERENCES_UPDATED: 'Preferences updated',

  // ============ Company ============
  COMPANY_NOT_FOUND: 'Company not found',

  // ============ Deal ============
  DEAL_NOT_FOUND: 'Deal not found',
  PIPELINE_NOT_FOUND: 'No pipeline found',
  STAGE_NOT_FOUND: 'Stage not found',
  STAGE_NOT_FOUND_BY_ID: 'Stage {{id}} not found',
  OWNER_ID_REQUIRED: 'ownerId is required (no user in context)',

  // ============ Quotation ============
  QUOTATION_NOT_FOUND: 'Quotation not found',
  SOURCE_QUOTATION_NOT_FOUND: 'Source quotation not found',
  QUOTATION_SENT_LOCK: 'Quotation is {{status}} and cannot be edited. Create a revision instead.',
  QUOTATION_LOCKED: 'Quotation is {{status}} and cannot be modified. Create a revision instead.',
  QUOTATION_ITEM_NOT_FOUND: 'Item not found',
  IMPORT_PLAN_INVALID: 'Invalid plan: {{message}}',
  IMPORT_EXTRACT_FAILED: 'Failed to extract import plan: {{message}}',
  IMPORT_COMMIT_FAILED: 'Failed to commit import: {{message}}',
  IMPORT_FILE_NOT_XLSX: 'file must be a .xlsx spreadsheet (got {{mimeType}})',

  // ============ Service ============
  SERVICE_NOT_FOUND: 'Service not found',
  UNSUPPORTED_CURRENCY: 'Unsupported currency "{{currency}}". Use RMB, HKD, or MOP.',

  // ============ Product ============
  PRODUCT_NOT_FOUND: 'Product not found',

  // ============ Contact ============
  CONTACT_NOT_FOUND: 'Contact not found',

  // ============ Man-day role ============
  MAN_DAY_ROLE_NOT_FOUND: 'Man-day role not found',
  MAN_DAY_ROLE_NAME_EXISTS: 'A man-day role named "{{name}}" already exists',

  // ============ Region ============
  REGION_NOT_FOUND: 'Region not found',
  REGION_IN_USE: 'Region is referenced by {{count}} company/companies',

  // ============ Role ============
  ROLE_NOT_FOUND: 'Role not found',
  ROLE_NAME_EXISTS: 'A role with this name already exists',
  ROLE_SYSTEM_RESERVED: 'Cannot create a system role by name — those are reserved',
  ROLE_NAME_FORMAT: 'Role name must be uppercase (e.g., "SENIOR_SALES")',
  ROLE_SYSTEM_DELETE: 'System roles cannot be deleted',
  ROLE_DEFAULT_VIEWER_MISSING: 'Default VIEWER role missing',
  INVALID_STATUS: 'Invalid status',
  ADMIN_ONLY: 'Admin only',

  // ============ Activity ============
  ACTIVITY_NOT_FOUND: 'Activity not found',
  ACTIVITY_CONTENT_EMPTY: 'content cannot be empty',
  ACTIVITY_CONTENT_REQUIRED: 'content is required',
  ACTIVITY_NOT_AUTHOR_EDIT: 'Only the author can edit this activity.',
  ACTIVITY_NOT_AUTHOR_DELETE: 'Only the author can delete this activity.',
  ACTIVITY_NOT_AUTHOR_UPLOAD: 'Only the author can upload attachments to this activity.',

  // ============ Chat ============
  CHAT_MESSAGE_REQUIRED: 'Message is required',
  CHAT_APPROVED_BOOLEAN: '`approved` must be a boolean',
  CHAT_NO_PENDING_CONFIRMATION: 'No pending confirmation with that id (may have timed out or already been answered)',
  CHAT_CONFIRMATION_NOT_OWNER: 'Confirmation does not belong to this user',
  CHAT_CONFIRMATION_RESOLVED: 'Confirmation already resolved',

  // ============ AI config ============
  AI_ENDPOINT_URL_INVALID: 'endpointUrl must be a valid http(s) URL',
  AI_API_KEY_TOO_SHORT: 'apiKey must be at least 8 characters',
  AI_MODEL_NAME_REQUIRED: 'modelName is required',
  AI_FORBIDDEN_READ: "Forbidden: missing permission 'ai-config:read'",
  AI_FORBIDDEN_UPDATE: "Forbidden: missing permission 'ai-config:update'",

  // ============ Attachment ============
  ATTACHMENT_NOT_FOUND: 'Attachment not found',
  ATTACHMENT_NOT_AUTHOR_DELETE: 'Only the activity author can delete this attachment.',
  ATTACHMENT_CONTENT_TYPE_INVALID: 'Content-Type must be multipart/form-data with a boundary',
  ATTACHMENT_FILE_FIELD_REQUIRED: 'file field is required (multipart key "file")',
  ATTACHMENT_FILE_GONE: 'File no longer exists on disk',
  ATTACHMENT_NO_FILE: 'No file provided',
  ATTACHMENT_MULTIPART_REQUIRED: 'multipart/form-data with boundary required',
  ATTACHMENT_TARGET_REQUIRED: 'Either companyId or dealId is required',
  ATTACHMENT_TARGET_MUTEX: 'Exactly one of companyId or dealId must be set',

  // ============ Currency (settings) ============
  CURRENCY_RATE_MISSING_HKD: 'No exchange rate configured for {{currency}} → HKD. Set it in /settings/currency.',
  CURRENCY_RATE_MISSING_MOP: 'No exchange rate configured for {{currency}} → MOP. Set it in /settings/currency.',
};