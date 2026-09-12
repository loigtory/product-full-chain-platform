import type { JsonValue } from './generated/app-server-0.153.4/serde_json/JsonValue.ts';

export const PRODUCT_WORK_TURN_OUTPUT_SCHEMA: JsonValue = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { type: 'string' },
    proposal: {
      type: ['string', 'null'],
      description:
        'Null, or one JSON-encoded object matching the platform action proposal candidate contract.',
    },
  },
  required: ['message', 'proposal'],
};
