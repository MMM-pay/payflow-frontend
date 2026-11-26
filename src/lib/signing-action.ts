const DESCRIPTIONS: Record<string, string> = {
  create_plan: "create a recurring payment plan",
  set_plan_active: "change a plan's availability",
  deactivate_page: "deactivate a batch of plans",
  set_plan_name: "rename a payment plan",
  set_profile: "update the merchant profile",
  deposit: "deposit tokens into a vault",
  withdraw: "withdraw tokens from a vault",
  deposit_for: "deposit tokens into another account's vault",
  subscribe: "start a recurring subscription",
  cancel: "cancel a subscription",
  pause: "pause a subscription",
  resume: "resume a subscription",
  set_max_charges: "change a subscription's charge limit",
  end_mandate: "permanently end a subscription",
  set_paused: "change a subscription's pause status",
  pause_until: "schedule a subscription pause",
  set_discount: "set a subscription discount",
  charge: "settle a due subscription charge",
  refund: "refund a subscription payment",
  transfer_mandate: "transfer a subscription to another account",
  accept_mandate_transfer: "accept a subscription transfer",
};

export function signingActionDescription(method: string): string {
  return DESCRIPTIONS[method] ?? `review the ${method.replaceAll("_", " ")} operation`;
}
