// Who the bot may answer. Pure; unit-tested.
//   staff      never (doctors and staff messaging the clinic number)
//   test_mode  while the client lists test numbers, everyone not on that list is left to people
export type Gate = "ok" | "staff" | "test_mode";
export function gate(phone: string | null | undefined, s: { test_numbers?: string[] | null; staff_numbers?: string[] | null }): Gate {
  const p = phone ?? "";
  if (p && (s.staff_numbers ?? []).includes(p)) return "staff";
  const test = s.test_numbers ?? [];
  if (test.length && !(p && test.includes(p))) return "test_mode";
  return "ok";
}
/** Comments: no automatic public / private replies while testing. */
export const commentsPaused = (s: { test_numbers?: string[] | null }) => (s.test_numbers ?? []).length > 0;
