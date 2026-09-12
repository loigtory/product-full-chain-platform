import type {
  MaterialPurpose,
  MaterialSourceType,
  SensitivityLevel,
} from '@pfc/contracts';

export const sourceLabels: Record<MaterialSourceType, string> = {
  BUSINESS_FEEDBACK: '业务反馈',
  USER_INTERVIEW: '用户访谈',
  OPERATIONS_ISSUE: '运营问题',
  INTERNAL_IMPROVEMENT: '内部改进',
  POLICY_OR_COMPLIANCE: '政策或合规',
  OTHER: '其他',
};

export const purposeLabels: Record<MaterialPurpose, string> = {
  FACT: '事实依据',
  CONSTRAINT: '约束条件',
  ASSUMPTION: '待验证假设',
  HISTORICAL_DESIGN: '历史设计',
  REGRESSION_SAMPLE: '回归样本',
};

export const sensitivityLabels: Record<SensitivityLevel, string> = {
  INTERNAL: '内部普通',
  RESTRICTED: '内部受限',
  PUBLIC: '可公开',
};

export function timestamp(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '读取失败，请稍后重试。';
}

export function selectValue<T extends string>(value: T | ''): T | null {
  return value || null;
}

export function readStored<T>(key: string): Partial<T> {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) ?? '{}') as Partial<T>;
  } catch {
    return {};
  }
}
