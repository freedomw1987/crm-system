import type { ApiErrorMessages } from './api-errors';

/**
 * 繁體中文 (zh-TW) error catalog — Taiwan Mandarin IT terminology.
 *
 * Vocabulary guide (Taiwan vs. 港式 vs. 大陆):
 *   軟體 (Taiwan) / 软件 (大陸) — software
 *   伺服器 (Taiwan) / 服务器 (大陸) — server
 *   資料庫 (Taiwan) / 数据库 (大陸) — database
 *   檔案 (Taiwan) / 文件 (大陸) — file
 *   訊息 (Taiwan) / 信息 (大陸) — message / information
 *   維護 (Taiwan) / 维护 (大陸) — maintenance
 *   業務 (Taiwan) / 业务 (大陸) — business / sales
 *   檢視 (Taiwan) / 查看 (大陸) — view (verb)
 *
 * Use this file as the baseline; `api-errors.zh-CN.ts` is generated
 * from this via `scripts/zh-tw-to-zh-cn.ts` substitutions.
 */
export const apiErrorsZhTw: ApiErrorMessages = {
  // ============ Global / generic ============
  NOT_FOUND: '找不到',
  UNAUTHORIZED: '未授權',
  FORBIDDEN: '權限不足:缺少「{{permission}}」權限',
  FORBIDDEN_ANY: '權限不足:需要以下其中之一 [{{permissions}}]',
  INTERNAL_ERROR: '伺服器內部錯誤',
  VALIDATION_FAILED: '驗證失敗',
  INVALID_INPUT: '輸入無效',

  // ============ Auth ============
  INVALID_CREDENTIALS: '帳號或密碼錯誤',
  INVALID_TOKEN: '無效的權杖',
  EMAIL_ALREADY_REGISTERED: '此電子郵件已被註冊',
  CURRENT_PASSWORD_WRONG: '目前密碼錯誤',
  // 密碼原則 (lib/password-policy.ts)
  PASSWORD_TOO_SHORT: '密碼至少需要 12 個字元',
  PASSWORD_NEEDS_DIGIT: '密碼需包含至少一個數字',
  PASSWORD_NEEDS_SPECIAL: '密碼需包含至少一個特殊字元',

  // ============ User management ============
  USER_NOT_FOUND: '找不到使用者',
  EMAIL_ALREADY_EXISTS: '此電子郵件已存在',
  INVALID_ROLE: '無效的角色',
  CANNOT_DEACTIVATE_SELF: '無法停用自己的帳號',
  CANNOT_DELETE_SELF: '無法刪除自己的帳號',
  CANNOT_DEMOTE_LAST_ADMIN: '無法降級最後一位管理員',
  CANNOT_DELETE_LAST_ADMIN: '無法刪除最後一位管理員',

  // ============ Preferences (i18n) ============
  INVALID_LOCALE: '無效的語系。支援：英文、繁體中文、簡體中文',
  PREFERENCES_UPDATED: '偏好設定已更新',

  // ============ Company ============
  COMPANY_NOT_FOUND: '找不到公司',

  // ============ Deal ============
  DEAL_NOT_FOUND: '找不到訂單',
  PIPELINE_NOT_FOUND: '找不到業務流程',
  STAGE_NOT_FOUND: '找不到階段',
  STAGE_NOT_FOUND_BY_ID: '找不到階段 {{id}}',
  OWNER_ID_REQUIRED: '需要 ownerId（使用者未登入）',

  // ============ Quotation ============
  QUOTATION_NOT_FOUND: '找不到報價',
  SOURCE_QUOTATION_NOT_FOUND: '找不到來源報價',
  QUOTATION_SENT_LOCK: '報價狀態為 {{status}}，無法編輯。請建立修訂版。',
  QUOTATION_LOCKED: '報價狀態為 {{status}}，無法修改。請建立修訂版。',
  QUOTATION_ITEM_NOT_FOUND: '找不到項目',
  IMPORT_PLAN_INVALID: '匯入計畫無效：{{message}}',
  IMPORT_EXTRACT_FAILED: '擷取匯入計畫失敗：{{message}}',
  IMPORT_COMMIT_FAILED: '提交匯入失敗：{{message}}',
  IMPORT_FILE_NOT_XLSX: '檔案必須為 .xlsx 試算表（收到 {{mimeType}}）',

  // ============ Service ============
  SERVICE_NOT_FOUND: '找不到服務',
  UNSUPPORTED_CURRENCY: '不支援的貨幣「{{currency}}」。請使用 RMB、HKD 或 MOP。',

  // ============ Product ============
  PRODUCT_NOT_FOUND: '找不到產品',

  // ============ Contact ============
  CONTACT_NOT_FOUND: '找不到聯絡人',

  // ============ Man-day role ============
  MAN_DAY_ROLE_NOT_FOUND: '找不到人天角色',
  MAN_DAY_ROLE_NAME_EXISTS: '已存在名稱為「{{name}}」的人天角色',

  // ============ Region ============
  REGION_NOT_FOUND: '找不到地區',
  REGION_IN_USE: '此地區被 {{count}} 家公司引用',

  // ============ Role ============
  ROLE_NOT_FOUND: '找不到角色',
  ROLE_NAME_EXISTS: '已存在相同名稱的角色',
  ROLE_SYSTEM_RESERVED: '無法以系統保留名稱建立角色',
  ROLE_NAME_FORMAT: '角色名稱必須為大寫英文（例如「SENIOR_SALES」）',
  ROLE_SYSTEM_DELETE: '無法刪除系統角色',
  ROLE_DEFAULT_VIEWER_MISSING: '缺少預設 VIEWER 角色',
  INVALID_STATUS: '無效的狀態',
  ADMIN_ONLY: '僅限管理員',

  // ============ Activity ============
  ACTIVITY_NOT_FOUND: '找不到活動記錄',
  ACTIVITY_CONTENT_EMPTY: '內容不可為空',
  ACTIVITY_CONTENT_REQUIRED: '需要填寫內容',
  ACTIVITY_NOT_AUTHOR_EDIT: '僅作者可編輯此活動記錄。',
  ACTIVITY_NOT_AUTHOR_DELETE: '僅作者可刪除此活動記錄。',
  ACTIVITY_NOT_AUTHOR_UPLOAD: '僅作者可為此活動記錄上傳附件。',

  // ============ Chat ============
  CHAT_MESSAGE_REQUIRED: '需要填寫訊息',
  CHAT_APPROVED_BOOLEAN: '`approved` 必須為布林值',
  CHAT_NO_PENDING_CONFIRMATION: '找不到對應的待處理確認（可能已逾時或已被回應）',
  CHAT_CONFIRMATION_NOT_OWNER: '此確認不屬於該使用者',
  CHAT_CONFIRMATION_RESOLVED: '確認已處理完畢',

  // ============ AI config ============
  AI_ENDPOINT_URL_INVALID: 'endpointUrl 必須為有效的 http(s) 網址',
  AI_API_KEY_TOO_SHORT: 'apiKey 至少需要 8 個字元',
  AI_MODEL_NAME_REQUIRED: '需要填寫 modelName',
  AI_FORBIDDEN_READ: "禁止存取：缺少權限 'ai-config:read'",
  AI_FORBIDDEN_UPDATE: "禁止存取：缺少權限 'ai-config:update'",

  // ============ Attachment ============
  ATTACHMENT_NOT_FOUND: '找不到附件',
  ATTACHMENT_NOT_AUTHOR_DELETE: '僅活動記錄作者可刪除此附件。',
  ATTACHMENT_CONTENT_TYPE_INVALID: 'Content-Type 必須為 multipart/form-data 並包含 boundary',
  ATTACHMENT_FILE_FIELD_REQUIRED: '需要 file 欄位（multipart 鍵值為「file」）',
  ATTACHMENT_FILE_GONE: '檔案已不存在於磁碟',
  ATTACHMENT_NO_FILE: '未提供檔案',
  ATTACHMENT_MULTIPART_REQUIRED: '需要 multipart/form-data 並包含 boundary',
  ATTACHMENT_TARGET_REQUIRED: '需要填寫 companyId 或 dealId',
  ATTACHMENT_TARGET_MUTEX: 'companyId 或 dealId 只能設定其中一個',

  // ============ Currency (settings) ============
  CURRENCY_RATE_MISSING_HKD: '未設定 {{currency}} → HKD 的匯率。請至 /settings/currency 設定。',
  CURRENCY_RATE_MISSING_MOP: '未設定 {{currency}} → MOP 的匯率。請至 /settings/currency 設定。',
};