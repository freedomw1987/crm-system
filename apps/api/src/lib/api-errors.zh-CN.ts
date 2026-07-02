import type { ApiErrorMessages } from './api-errors';

/**
 * 简体中文 (zh-CN) error catalog — 大陆 Mandarin IT terminology.
 *
 * Generated from `api-errors.zh-TW.ts` via `scripts/zh-tw-to-zh-cn.ts`
 * — that script applies a curated substitution table to keep the
 * two catalogs in lock-step. Edit both files if you change wording.
 */
export const apiErrorsZhCn: ApiErrorMessages = {
  // ============ Global / generic ============
  NOT_FOUND: '未找到',
  UNAUTHORIZED: '未授权',
  FORBIDDEN: '权限不足:缺少「{{permission}}」权限',
  FORBIDDEN_ANY: '权限不足:需要以下其中之一 [{{permissions}}]',
  INTERNAL_ERROR: '服务器内部错误',
  VALIDATION_FAILED: '验证失败',
  INVALID_INPUT: '输入无效',

  // ============ Auth ============
  INVALID_CREDENTIALS: '账号或密码错误',
  INVALID_TOKEN: '无效的令牌',
  EMAIL_ALREADY_REGISTERED: '此电子邮件已被注册',
  CURRENT_PASSWORD_WRONG: '当前密码错误',
  // 密码策略 (lib/password-policy.ts)
  PASSWORD_TOO_SHORT: '密码至少需要 12 个字符',
  PASSWORD_NEEDS_DIGIT: '密码需包含至少一个数字',
  PASSWORD_NEEDS_SPECIAL: '密码需包含至少一个特殊字符',

  // ============ User management ============
  USER_NOT_FOUND: '未找到用户',
  EMAIL_ALREADY_EXISTS: '此电子邮件已存在',
  INVALID_ROLE: '无效的角色',
  CANNOT_DEACTIVATE_SELF: '无法停用自己的账号',
  CANNOT_DELETE_SELF: '无法删除自己的账号',
  CANNOT_DEMOTE_LAST_ADMIN: '无法降级最后一位管理员',
  CANNOT_DELETE_LAST_ADMIN: '无法删除最后一位管理员',

  // ============ Preferences (i18n) ============
  INVALID_LOCALE: '无效的语言。支援：英文、繁体中文、简体中文',
  PREFERENCES_UPDATED: '偏好设置已更新',

  // ============ Company ============
  COMPANY_NOT_FOUND: '未找到公司',

  // ============ Deal ============
  DEAL_NOT_FOUND: '未找到订单',
  PIPELINE_NOT_FOUND: '未找到业务流程',
  STAGE_NOT_FOUND: '未找到阶段',
  STAGE_NOT_FOUND_BY_ID: '未找到阶段 {{id}}',
  OWNER_ID_REQUIRED: '需要 ownerId（用户未登录）',

  // ============ Quotation ============
  QUOTATION_NOT_FOUND: '未找到报价',
  SOURCE_QUOTATION_NOT_FOUND: '未找到来源报价',
  QUOTATION_SENT_LOCK: '报价状态为 {{status}}，无法编辑。请建立修订版。',
  QUOTATION_LOCKED: '报价状态为 {{status}}，无法修改。请建立修订版。',
  QUOTATION_ITEM_NOT_FOUND: '未找到项目',
  IMPORT_PLAN_INVALID: '导入计划无效：{{message}}',
  IMPORT_EXTRACT_FAILED: '提取导入计划失败：{{message}}',
  IMPORT_COMMIT_FAILED: '提交导入失败：{{message}}',
  IMPORT_FILE_NOT_XLSX: '文件必须为 .xlsx 电子表格（收到 {{mimeType}}）',

  // ============ Service ============
  SERVICE_NOT_FOUND: '未找到服务',
  UNSUPPORTED_CURRENCY: '不支持的货币"{{currency}}"。请使用 RMB、HKD 或 MOP。',

  // ============ Product ============
  PRODUCT_NOT_FOUND: '未找到产品',

  // ============ Contact ============
  CONTACT_NOT_FOUND: '未找到联系人',

  // ============ Man-day role ============
  MAN_DAY_ROLE_NOT_FOUND: '未找到人天角色',
  MAN_DAY_ROLE_NAME_EXISTS: '已存在名称为"{{name}}"的人天角色',

  // ============ Region ============
  REGION_NOT_FOUND: '未找到地区',
  REGION_IN_USE: '此地区被 {{count}} 家公司引用',

  // ============ Role ============
  ROLE_NOT_FOUND: '未找到角色',
  ROLE_NAME_EXISTS: '已存在相同名称的角色',
  ROLE_SYSTEM_RESERVED: '无法以系统保留名称创建角色',
  ROLE_NAME_FORMAT: '角色名称必须为大写英文（例如"SENIOR_SALES"）',
  ROLE_SYSTEM_DELETE: '无法删除系统角色',
  ROLE_DEFAULT_VIEWER_MISSING: '缺少默认 VIEWER 角色',
  INVALID_STATUS: '无效的状态',
  ADMIN_ONLY: '仅限管理员',

  // ============ Activity ============
  ACTIVITY_NOT_FOUND: '未找到活动记录',
  ACTIVITY_CONTENT_EMPTY: '内容不可为空',
  ACTIVITY_CONTENT_REQUIRED: '需要填写内容',
  ACTIVITY_NOT_AUTHOR_EDIT: '仅作者可编辑此活动记录。',
  ACTIVITY_NOT_AUTHOR_DELETE: '仅作者可删除此活动记录。',
  ACTIVITY_NOT_AUTHOR_UPLOAD: '仅作者可为此活动记录上传附件。',

  // ============ Chat ============
  CHAT_MESSAGE_REQUIRED: '需要填写信息',
  CHAT_APPROVED_BOOLEAN: '`approved` 必须为布尔值',
  CHAT_NO_PENDING_CONFIRMATION: '未找到对应的待处理确认（可能已超时或已被响应）',
  CHAT_CONFIRMATION_NOT_OWNER: '此确认不属于该用户',
  CHAT_CONFIRMATION_RESOLVED: '确认已处理完毕',

  // ============ AI config ============
  AI_ENDPOINT_URL_INVALID: 'endpointUrl 必须为有效的 http(s) 网址',
  AI_API_KEY_TOO_SHORT: 'apiKey 至少需要 8 个字符',
  AI_MODEL_NAME_REQUIRED: '需要填写 modelName',
  AI_FORBIDDEN_READ: "禁止访问：缺少权限 'ai-config:read'",
  AI_FORBIDDEN_UPDATE: "禁止访问：缺少权限 'ai-config:update'",

  // ============ Attachment ============
  ATTACHMENT_NOT_FOUND: '未找到附件',
  ATTACHMENT_NOT_AUTHOR_DELETE: '仅活动记录作者可删除此附件。',
  ATTACHMENT_CONTENT_TYPE_INVALID: 'Content-Type 必须为 multipart/form-data 并包含 boundary',
  ATTACHMENT_FILE_FIELD_REQUIRED: '需要 file 字段（multipart 键值为"file"）',
  ATTACHMENT_FILE_GONE: '文件已不存在于磁盘',
  ATTACHMENT_NO_FILE: '未提供文件',
  ATTACHMENT_MULTIPART_REQUIRED: '需要 multipart/form-data 并包含 boundary',
  ATTACHMENT_TARGET_REQUIRED: '需要填写 companyId 或 dealId',
  ATTACHMENT_TARGET_MUTEX: 'companyId 或 dealId 只能设置其中一个',

  // ============ Currency (settings) ============
  CURRENCY_RATE_MISSING_HKD: '未设置 {{currency}} → HKD 的汇率。请至 /settings/currency 设置。',
  CURRENCY_RATE_MISSING_MOP: '未设置 {{currency}} → MOP 的汇率。请至 /settings/currency 设置。',
};