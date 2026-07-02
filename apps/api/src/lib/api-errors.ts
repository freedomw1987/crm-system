/**
 * The full set of error keys the API can emit. Each locale file
 * (`api-errors.en.ts`, `api-errors.zh-TW.ts`, `api-errors.zh-CN.ts`)
 * must implement this type — TypeScript will refuse to compile if
 * a key is missing in any locale, so partial translations surface
 * immediately.
 *
 * Template variables use `{{varName}}` syntax. See `i18n.ts`'s
 * `tApi()` for interpolation details.
 *
 * Why a typed map (vs error codes): the wire format is
 * `{ error: "<human string>" }`. Each key maps directly to the
 * English baseline string. Translating per-locale is a copy of
 * this object with values swapped. Adding a new error is one
 * TS file change + three locale files; no migration of the wire
 * format needed.
 */
export interface ApiErrorMessages {
  // ============ Global / generic ============
  NOT_FOUND: string;
  UNAUTHORIZED: string;
  FORBIDDEN: string;            // {{permission}}
  FORBIDDEN_ANY: string;        // {{permissions}}
  INTERNAL_ERROR: string;
  VALIDATION_FAILED: string;
  INVALID_INPUT: string;

  // ============ Auth ============
  INVALID_CREDENTIALS: string;
  INVALID_TOKEN: string;
  EMAIL_ALREADY_REGISTERED: string;
  CURRENT_PASSWORD_WRONG: string;
  // Password policy: validateStrongPassword strings (lib/password-policy.ts)
  PASSWORD_TOO_SHORT: string;
  PASSWORD_NEEDS_DIGIT: string;
  PASSWORD_NEEDS_SPECIAL: string;

  // ============ User management ============
  USER_NOT_FOUND: string;
  EMAIL_ALREADY_EXISTS: string;
  INVALID_ROLE: string;
  CANNOT_DEACTIVATE_SELF: string;
  CANNOT_DELETE_SELF: string;
  CANNOT_DEMOTE_LAST_ADMIN: string;
  CANNOT_DELETE_LAST_ADMIN: string;

  // ============ Preferences (i18n) ============
  INVALID_LOCALE: string;
  PREFERENCES_UPDATED: string;

  // ============ Company ============
  COMPANY_NOT_FOUND: string;

  // ============ Deal ============
  DEAL_NOT_FOUND: string;
  PIPELINE_NOT_FOUND: string;
  STAGE_NOT_FOUND: string;
  STAGE_NOT_FOUND_BY_ID: string;  // {{id}}
  OWNER_ID_REQUIRED: string;

  // ============ Quotation ============
  QUOTATION_NOT_FOUND: string;
  SOURCE_QUOTATION_NOT_FOUND: string;
  QUOTATION_SENT_LOCK: string;    // {{status}}
  QUOTATION_LOCKED: string;       // {{status}}
  QUOTATION_ITEM_NOT_FOUND: string;
  IMPORT_PLAN_INVALID: string;    // {{message}}
  IMPORT_EXTRACT_FAILED: string;  // {{message}}
  IMPORT_COMMIT_FAILED: string;   // {{message}}
  IMPORT_FILE_NOT_XLSX: string;   // {{mimeType}}

  // ============ Service ============
  SERVICE_NOT_FOUND: string;
  UNSUPPORTED_CURRENCY: string;   // {{currency}}

  // ============ Product ============
  PRODUCT_NOT_FOUND: string;

  // ============ Contact ============
  CONTACT_NOT_FOUND: string;

  // ============ Man-day role ============
  MAN_DAY_ROLE_NOT_FOUND: string;
  MAN_DAY_ROLE_NAME_EXISTS: string;  // {{name}}

  // ============ Region ============
  REGION_NOT_FOUND: string;
  REGION_IN_USE: string;  // {{count}}

  // ============ Role ============
  ROLE_NOT_FOUND: string;
  ROLE_NAME_EXISTS: string;
  ROLE_SYSTEM_RESERVED: string;
  ROLE_NAME_FORMAT: string;
  ROLE_SYSTEM_DELETE: string;
  ROLE_DEFAULT_VIEWER_MISSING: string;
  INVALID_STATUS: string;
  ADMIN_ONLY: string;

  // ============ Activity ============
  ACTIVITY_NOT_FOUND: string;
  ACTIVITY_CONTENT_EMPTY: string;
  ACTIVITY_CONTENT_REQUIRED: string;
  ACTIVITY_NOT_AUTHOR_EDIT: string;
  ACTIVITY_NOT_AUTHOR_DELETE: string;
  ACTIVITY_NOT_AUTHOR_UPLOAD: string;

  // ============ Chat ============
  CHAT_MESSAGE_REQUIRED: string;
  CHAT_APPROVED_BOOLEAN: string;
  CHAT_NO_PENDING_CONFIRMATION: string;
  CHAT_CONFIRMATION_NOT_OWNER: string;
  CHAT_CONFIRMATION_RESOLVED: string;

  // ============ AI config ============
  AI_ENDPOINT_URL_INVALID: string;
  AI_API_KEY_TOO_SHORT: string;
  AI_MODEL_NAME_REQUIRED: string;
  AI_FORBIDDEN_READ: string;
  AI_FORBIDDEN_UPDATE: string;

  // ============ Attachment ============
  ATTACHMENT_NOT_FOUND: string;
  ATTACHMENT_NOT_AUTHOR_DELETE: string;
  ATTACHMENT_CONTENT_TYPE_INVALID: string;
  ATTACHMENT_FILE_FIELD_REQUIRED: string;
  ATTACHMENT_FILE_GONE: string;
  ATTACHMENT_NO_FILE: string;
  ATTACHMENT_MULTIPART_REQUIRED: string;
  ATTACHMENT_TARGET_REQUIRED: string;
  ATTACHMENT_TARGET_MUTEX: string;

  // ============ Currency (settings) ============
  CURRENCY_RATE_MISSING_HKD: string;  // {{currency}}
  CURRENCY_RATE_MISSING_MOP: string;  // {{currency}}
}

/**
 * Required-by-contract: every locale must implement every key
 * (TS enforces this via `satisfies ApiErrorMessages` in each file).
 */
export type ApiErrorLocale = 'en' | 'zh-TW' | 'zh-CN';