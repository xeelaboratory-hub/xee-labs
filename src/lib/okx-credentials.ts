// ── OKX API credential shape validation ──────────────────────────────────
// Client-side pre-flight for the Exchange Connections form. OKX rejects bad
// credentials only at request time, and the backend surfaces that as a
// generic 502 → "Exchange error" in AccountPanel, which doesn't say *which*
// field is wrong. These checks catch the paste mistakes locally, before a
// broken credential is encrypted and stored.
//
// Errors block submission; they assert a state that is known-bad regardless
// of any future OKX format change (empty field, secret that is really a
// second copy of the key). Warnings are advisory only — they assert the
// *positive* format OKX uses today, and a format change on OKX's side should
// not be able to lock a user out of saving a valid credential.

/** OKX API Key: a UUID, e.g. 1a2b3c4d-5e6f-7890-abcd-ef1234567890 */
const OKX_API_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** OKX Secret Key: 32 uppercase hex characters, no dashes. */
const OKX_API_SECRET_RE = /^[0-9A-F]{32}$/;

export type OkxCredentialField = "apiKey" | "apiSecret" | "passphrase";

export type OkxCredentialFields = Record<OkxCredentialField, string>;

export type OkxCredentialIssue = {
  field: OkxCredentialField;
  /** "required" issues are suppressed by the form while a field is still
   *  untouched, so a pristine form isn't covered in red on first render. */
  kind: "required" | "shape";
  message: string;
};

export type OkxCredentialValidation = {
  /** Blocking problems — submission must not proceed while non-empty. */
  errors: OkxCredentialIssue[];
  /** Advisory format mismatches — shown, but do not block submission. */
  warnings: OkxCredentialIssue[];
};

/** Trims every field. Pasted keys routinely carry a trailing newline/space,
 *  which OKX counts as part of the value and rejects. */
export function trimCredentialFields(fields: OkxCredentialFields): OkxCredentialFields {
  return {
    apiKey: fields.apiKey.trim(),
    apiSecret: fields.apiSecret.trim(),
    passphrase: fields.passphrase.trim(),
  };
}

export function validateOkxCredentials(fields: OkxCredentialFields): OkxCredentialValidation {
  const { apiKey, apiSecret, passphrase } = trimCredentialFields(fields);
  const errors: OkxCredentialIssue[] = [];
  const warnings: OkxCredentialIssue[] = [];

  if (!apiKey) errors.push({ field: "apiKey", kind: "required", message: "API Key is required." });
  if (!apiSecret) errors.push({ field: "apiSecret", kind: "required", message: "API Secret is required." });
  if (!passphrase) {
    errors.push({ field: "passphrase", kind: "required", message: "Passphrase is required." });
  }

  if (apiKey && apiSecret) {
    if (apiKey === apiSecret) {
      errors.push({
        field: "apiSecret",
        kind: "shape",
        message:
          "API Secret is identical to the API Key. Copy the Secret Key from OKX — it is a separate value, shown only once when the key is created.",
      });
    } else if (OKX_API_KEY_RE.test(apiSecret)) {
      // A UUID is the shape of an OKX *key*, never of a secret — so this is a
      // mis-paste even when it isn't a copy of the key in this same form.
      errors.push({
        field: "apiSecret",
        kind: "shape",
        message:
          "API Secret looks like an API Key (UUID format). The Secret Key is 32 hexadecimal characters with no dashes.",
      });
    }
  }

  if (apiKey && !OKX_API_KEY_RE.test(apiKey)) {
    warnings.push({
      field: "apiKey",
      kind: "shape",
      message: "API Key doesn't look like an OKX key — expected a UUID (36 characters, 4 dashes).",
    });
  }

  const secretAlreadyRejected = errors.some((e) => e.field === "apiSecret" && e.kind === "shape");
  if (apiSecret && !secretAlreadyRejected && !OKX_API_SECRET_RE.test(apiSecret)) {
    warnings.push({
      field: "apiSecret",
      kind: "shape",
      message: "API Secret doesn't look like an OKX secret — expected 32 uppercase hexadecimal characters.",
    });
  }

  return { errors, warnings };
}
