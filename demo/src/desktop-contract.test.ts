import { expect, test } from "bun:test";
import type { DesktopApi } from "./desktop";
import { withoutLegacyInvestigatorEdit } from "./desktop";

test("renderer strips the legacy investigator edit method without invoking it", () => {
  let invoked = 0;
  const raw = {
    campaign: {
      applyCharacterCard() {
        invoked += 1;
      },
    },
  } as unknown as DesktopApi;

  const api = withoutLegacyInvestigatorEdit(raw);

  expect("applyCharacterCard" in api.campaign).toBe(false);
  expect(invoked).toBe(0);
});
