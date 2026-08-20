import { describe, expect, it } from "vitest";
import { trimCredentialFields, validateOkxCredentials } from "@/lib/okx-credentials";

// A structurally valid OKX pair: key is a UUID, secret is 32 uppercase hex.
const VALID_KEY = "1a2b3c4d-5e6f-7890-abcd-ef1234567890";
const VALID_SECRET = "0123456789ABCDEF0123456789ABCDEF";

const fields = (overrides: Partial<Record<"apiKey" | "apiSecret" | "passphrase", string>> = {}) => ({
  apiKey: VALID_KEY,
  apiSecret: VALID_SECRET,
  passphrase: "s3cret-phrase",
  ...overrides,
});

describe("OKX credential validation", () => {
  it("accepts a well-formed key/secret/passphrase triple", () => {
    const { errors, warnings } = validateOkxCredentials(fields());

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("blocks a secret that is a second copy of the API key", () => {
    // The exact mis-paste that reached the backend and surfaced only as a
    // generic "Exchange error" after OKX rejected the request.
    const { errors } = validateOkxCredentials(fields({ apiSecret: VALID_KEY }));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("apiSecret");
    expect(errors[0]?.message).toContain("identical to the API Key");
  });

  it("blocks a UUID-shaped secret even when it differs from the key", () => {
    const { errors } = validateOkxCredentials({
      ...fields(),
      apiSecret: "99999999-8888-7777-6666-555555555555",
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("looks like an API Key");
  });

  it("reports a whitespace-only field as required, not as valid", () => {
    const { errors } = validateOkxCredentials(fields({ passphrase: "   " }));

    expect(errors).toEqual([{ field: "passphrase", kind: "required", message: "Passphrase is required." }]);
  });

  it("flags unexpected formats as warnings without blocking submission", () => {
    const { errors, warnings } = validateOkxCredentials({
      apiKey: "not-a-uuid",
      apiSecret: "shortsecret",
      passphrase: "s3cret-phrase",
    });

    expect(errors).toEqual([]);
    expect(warnings.map((w) => w.field)).toEqual(["apiKey", "apiSecret"]);
  });

  it("does not stack a format warning on a secret already blocked as an error", () => {
    const { errors, warnings } = validateOkxCredentials(fields({ apiSecret: VALID_KEY }));

    expect(errors).toHaveLength(1);
    expect(warnings.some((w) => w.field === "apiSecret")).toBe(false);
  });

  it("validates against trimmed values so a pasted newline doesn't hide a duplicate", () => {
    const { errors } = validateOkxCredentials(fields({ apiSecret: `${VALID_KEY}\n` }));

    expect(errors[0]?.message).toContain("identical to the API Key");
  });

  it("trims every field for submission", () => {
    expect(trimCredentialFields({ apiKey: ` ${VALID_KEY} `, apiSecret: `${VALID_SECRET}\n`, passphrase: " p " })).toEqual(
      { apiKey: VALID_KEY, apiSecret: VALID_SECRET, passphrase: "p" },
    );
  });
});
