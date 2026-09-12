export type BootstrapStatus = Readonly<{
  state: 'ready';
  scope: 'T0';
  businessFeatures: false;
}>;

export function createBootstrapStatus(): BootstrapStatus {
  return {
    state: 'ready',
    scope: 'T0',
    businessFeatures: false,
  };
}
