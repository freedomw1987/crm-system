import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RETENTION_DAYS,
  PRUNE_BATCH_SIZE,
  SENSITIVE_ACTIONS,
  SENSITIVE_RETENTION_DAYS,
} from '../audit-log-prune';

describe('audit-log-prune constants (P1-6)', () => {
  test('default retention is 365 days (ADR 0014 §1)', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(365);
  });

  test('sensitive retention is 730 days (ADR 0014 §1)', () => {
    expect(SENSITIVE_RETENTION_DAYS).toBe(730);
  });

  test('batch size is 10k rows', () => {
    expect(PRUNE_BATCH_SIZE).toBe(10_000);
  });

  test('sensitive list contains all security-critical actions', () => {
    expect(SENSITIVE_ACTIONS).toContain('ROLE_CREATED');
    expect(SENSITIVE_ACTIONS).toContain('ROLE_UPDATED');
    expect(SENSITIVE_ACTIONS).toContain('ROLE_DELETED');
    expect(SENSITIVE_ACTIONS).toContain('AI_CONFIG_UPDATED');
    expect(SENSITIVE_ACTIONS).toContain('USER_DELETED');
    expect(SENSITIVE_ACTIONS).toContain('AI_TOOL_CONFIRMED');
    expect(SENSITIVE_ACTIONS).toContain('AI_TOOL_DENIED');
  });

  test('sensitive list does NOT contain non-security actions', () => {
    expect(SENSITIVE_ACTIONS).not.toContain('USER_LOGIN');
    expect(SENSITIVE_ACTIONS).not.toContain('COMPANY_CREATED');
    expect(SENSITIVE_ACTIONS).not.toContain('DEAL_CREATED');
    expect(SENSITIVE_ACTIONS).not.toContain('QUOTATION_CREATED');
  });

  test('sensitive list has no duplicates', () => {
    const set = new Set(SENSITIVE_ACTIONS);
    expect(set.size).toBe(SENSITIVE_ACTIONS.length);
  });
});
