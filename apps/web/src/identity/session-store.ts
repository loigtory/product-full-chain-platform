let csrfToken = '';

export function setCsrfToken(value: string): void {
  csrfToken = value;
}

export function getCsrfToken(): string {
  return csrfToken;
}

export function clearCsrfToken(): void {
  csrfToken = '';
}
