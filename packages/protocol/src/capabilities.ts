export const CAPABILITY_STATES = [
  'UNAVAILABLE',
  'UNVERIFIED',
  'AVAILABLE',
] as const;

export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export function capabilityState(input: {
  installed: boolean;
  configured: boolean;
  verified: boolean;
}): CapabilityState {
  if (!input.installed) return 'UNAVAILABLE';
  if (!input.configured || !input.verified) return 'UNVERIFIED';
  return 'AVAILABLE';
}
