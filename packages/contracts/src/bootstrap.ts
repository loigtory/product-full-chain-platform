export type BootstrapHealthResponse = Readonly<{
  status: 'ok';
  stage: 'bootstrap' | 't3' | 't4' | 't5' | 't6' | 't7';
  businessFeatures: boolean;
}>;
