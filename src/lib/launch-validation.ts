import { z } from "zod";

export const launchAcknowledgementsSchema = z
  .object({
    noInvestmentValue: z.literal(true),
    noAffiliation: z.literal(true),
    contentRights: z.literal(true),
    jurisdictionAllowed: z.literal(true),
    userWalletPaysGas: z.literal(true).optional(),
    liveAdminControlled: z.literal(true).optional()
  })
  .refine((value) => value.userWalletPaysGas === true || value.liveAdminControlled === true, {
    message: "Launch execution acknowledgement is required."
  });

export const launchRequestSchema = z.object({
  draftId: z.string().min(1),
  name: z.string().min(2).max(64),
  ticker: z
    .string()
    .min(3)
    .max(6)
    .regex(/^[A-Z0-9]+$/),
  description: z.string().min(20).max(1000),
  tokenomics: z.object({
    supply: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
    allocation: z.array(
      z.object({
        label: z.string().min(1).max(60),
        percent: z.number().min(0).max(100)
      })
    ),
    notes: z.array(z.string().max(160))
  }),
  acknowledgements: launchAcknowledgementsSchema
});

export type ValidatedLaunchRequest = z.infer<typeof launchRequestSchema>;

export function validateLaunchRequestShape(body: unknown) {
  return launchRequestSchema.safeParse(body);
}

export function validateTokenomics(input: ValidatedLaunchRequest) {
  const allocationTotal = input.tokenomics.allocation.reduce((sum, row) => sum + row.percent, 0);
  if (allocationTotal !== 100) {
    return "Tokenomics allocation must total 100%.";
  }

  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(input.tokenomics.supply)) {
    return "Token supply must be a whole number.";
  }

  const supply = BigInt(input.tokenomics.supply.replace(/,/g, ""));
  if (supply <= 0n) {
    return "Token supply must be a positive number.";
  }

  return null;
}
