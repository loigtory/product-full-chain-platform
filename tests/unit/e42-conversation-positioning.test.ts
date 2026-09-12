import { describe, expect, it } from 'vitest';

import { shouldAutoFollowConversation } from '../../apps/web/src/work-sessions/conversation-positioning.ts';

describe('AI-UX-R1 E4.2 conversation positioning policy', () => {
  it('follows initial recovery, near-bottom updates and the user own submit', () => {
    expect(
      shouldAutoFollowConversation({
        initialRecovery: true,
        nearBottom: false,
        ownSubmitPending: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoFollowConversation({
        initialRecovery: false,
        nearBottom: true,
        ownSubmitPending: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoFollowConversation({
        initialRecovery: false,
        nearBottom: false,
        ownSubmitPending: true,
      }),
    ).toBe(true);
  });

  it('does not steal position while the user inspects history', () => {
    expect(
      shouldAutoFollowConversation({
        initialRecovery: false,
        nearBottom: false,
        ownSubmitPending: false,
      }),
    ).toBe(false);
  });
});
