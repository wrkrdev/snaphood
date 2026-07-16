import { normalizeDraft } from "../src/lib/ai";

const malformed = normalizeDraft({
  name: "Profit Rocket Cat With An Extremely Long Name That Should Stay Bounded By The Schema",
  ticker: "cat-100x!!!",
  description: "Guaranteed 100x investment returns from this moonshot cat token.",
  promptSummary: "risk-free pump poster with financial advice",
  tokenomics: {
    supply: "not-a-number",
    decimals: 99,
    allocation: [
      { label: "Guaranteed profit vault", percent: 90 },
      { label: "Team", percent: 90 }
    ],
    notes: ["risk-free investment returns", "No transfer tax."]
  }
});

assert(malformed.name.length <= 64, "name should be bounded");
assert(malformed.ticker === "CAT100", `ticker should be sanitized, got ${malformed.ticker}`);
assert(!/guaranteed|100x|investment|returns|moonshot/i.test(malformed.description), "description should remove promise language");
assert(!/risk-free|pump|financial advice/i.test(malformed.promptSummary), "prompt summary should remove promise language");
assert(malformed.tokenomics.supply === "1000000000", "invalid supply should fall back to default");
assert(malformed.tokenomics.decimals === 18, "invalid decimals should fall back to default");
assert(
  malformed.tokenomics.allocation.reduce((sum, row) => sum + row.percent, 0) === 100,
  "invalid allocation total should fall back to 100%"
);
assert(!malformed.tokenomics.notes.some((note) => /risk-free|investment|returns/i.test(note)), "notes should remove promise language");

const sparse = normalizeDraft({});
assert(sparse.ticker === "SNAP", "empty ticker should fall back to SNAP");
assert(sparse.description.length >= 20, "sparse draft should still have a usable description");
assert(sparse.tokenomics.allocation.length > 0, "sparse draft should include allocation rows");

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: ["ticker", "description", "promptSummary", "supply", "decimals", "allocation", "notes", "sparse"]
    },
    null,
    2
  )
);

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}
