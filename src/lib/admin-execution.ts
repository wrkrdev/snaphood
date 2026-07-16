export const adminExecutionConfirmation = "EXECUTE_LIVE_TRADE";

export function hasAdminExecutionConfirmation(value: string | undefined) {
  return value === adminExecutionConfirmation;
}
