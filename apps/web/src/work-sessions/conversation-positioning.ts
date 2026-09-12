export function shouldAutoFollowConversation(input: {
  initialRecovery: boolean;
  nearBottom: boolean;
  ownSubmitPending: boolean;
}): boolean {
  return input.initialRecovery || input.nearBottom || input.ownSubmitPending;
}
