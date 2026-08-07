# Security

## Threat model summary

| Asset | Threat | Control |
| --- | --- | --- |
| First-party customer evidence (may contain PII, health, financial, contractual data) | Cross-tenant read | Three-layer isolation (session guard, query predicate, `organization_id` column) + integration tests |
| Vendor API keys | Exposure in client bundle, logs, exports | Server-only modules, AES-256-GCM at rest, log redaction serializer, never returned by a server action |
| Uploaded files | Malicious content, oversized payloads, type confusion | Extension + MIME + magic-byte checks, 25 MB cap, no execution, stored outside the web root, filename sanitisation |
| URL ingestion | SSRF into internal networks / cloud metadata | Domain allowlist per brand + DNS resolution check rejecting private and link-local ranges + redirect re-validation + content-type check + byte/page caps |
| Sessions | Theft, fixation, CSRF | httpOnly + Secure + SameSite=Lax cookies, 32-byte random ids hashed at rest, rotation on sign-in, double-submit CSRF token on every mutating action |
| Profound account | Accidental prompt spam / duplicates | Dry run required, explicit approval, idempotency via unique link index, immutable receipts |
| Audit trail | Silent tampering | `audit_logs` insert-only from the service layer; approvals, exports and deletions always logged |

## Authentication

Credentials-based sessions (ADR-003).

- Passwords hashed with `scrypt` (N=16384, r=8, p=1, 16-byte salt, 64-byte key), compared with `timingSafeEqual`.
- Session ids: 32 random bytes, base64url. Only the SHA-256 hash is stored in `sessions`; the raw value lives only in the cookie.
- Cookie: `pes_session`, `httpOnly`, `sameSite=lax`, `secure` in production, 30-day rolling expiry, rotated on sign-in and cleared on sign-out.
- Sign-in failures are rate-limited per IP+email (10 attempts / 15 min) and always return the same generic message.

## Authorization

Roles on `memberships`: `owner` > `admin` > `editor` > `viewer`.

| Capability | viewer | editor | admin | owner |
| --- | :-: | :-: | :-: | :-: |
| Read brand data | ✓ | ✓ | ✓ | ✓ |
| Upload sources, generate artefacts | | ✓ | ✓ | ✓ |
| Approve persona / prompt set | | ✓ | ✓ | ✓ |
| Deploy to Profound | | | ✓ | ✓ |
| Manage integrations & credentials | | | ✓ | ✓ |
| Delete sources | | | ✓ | ✓ |
| Manage members, delete brand | | | | ✓ |

`requireCapability(ctx, "profound:deploy")` is checked in the service layer, not only in the UI. `tests/unit/permissions.test.ts` covers the full matrix.

## Credential storage

`vendor_credentials` stores `ciphertext`, `iv`, `auth_tag`, `key_version`. AES-256-GCM with a key derived from `APP_ENCRYPTION_KEY` (32 bytes, base64). Decryption happens only inside adapter construction. The UI shows a masked last-4 and a "configured / not configured" state; the plaintext is never sent to the browser after being saved. Rotation is supported through `key_version`.

## PII redaction

`src/lib/redaction.ts` runs before evidence extraction and before anything is sent to a model provider. Patterns: email, phone (E.164 and common national formats), IPv4/IPv6, credit-card-shaped numbers passing Luhn, US SSN, street-address-shaped lines, and named-person heuristics limited to speaker labels. Each match is replaced with a typed placeholder (`[EMAIL_1]`) and counted; `evidence_records.pii_status` records `none` | `redacted` | `suspected`.

**Displayed in the product, on the upload screen and on every evidence detail view:**

> Automated PII detection is best-effort pattern matching. It is not a substitute for legal or compliance review. Do not upload data you are not entitled to process.

Sources can be excluded from model calls entirely (`data_sources.exclude_from_model_calls`) for sensitive material.

## SSRF protection for URL ingestion

`src/lib/url-guard.ts`, applied on every fetch including redirects:

1. Scheme must be `http`/`https`.
2. Host must match the brand's `approved_crawl_domains` (exact or subdomain).
3. Resolve DNS; reject `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (incl. `169.254.169.254`), `::1`, `fc00::/7`, `fe80::/10`, and any non-global address.
4. Max 5 redirects, each re-validated from step 1.
5. Content-Type must be HTML/text; `Content-Length` and streamed bytes capped (2 MB/page, 50 pages/crawl).
6. `robots.txt` respected; 1 request/second per host.

This is a bounded brand-page fetcher, not a general-purpose crawler.

## Input validation

Every server action parses its input with Zod before touching a service. Every vendor response and every LLM structured output is parsed with Zod before persistence. Drizzle parameterises all queries; no string-concatenated SQL, and the one raw fragment (full-text search) uses bound parameters.

## CSRF

Double-submit: a random token in a non-httpOnly `pes_csrf` cookie is mirrored into a hidden field on every form and compared server-side with `timingSafeEqual`. Combined with `SameSite=Lax` cookies.

## Rate limiting

In-process token bucket (`src/lib/rate-limit.ts`) on sign-in, upload, URL ingestion, and generation actions. Documented limitation: this is per-process and therefore not correct behind multiple app instances — a shared store is required before horizontal scaling.

## Logging

`pino` with a redaction serializer for `authorization`, `apiKey`, `api_key`, `password`, `token`, `cookie`, `set-cookie`, `secret`. Never logged: API keys, auth tokens, full confidential source text, unredacted PII. Errors returned to the browser go through `toPublicError()`; details stay in the job row and server log.

## Retention and deletion

`brands.retention_days` (nullable = keep). A retention job soft-deletes expired sources. Source deletion: removes the object from storage, deletes `evidence_embeddings`, marks `evidence_records.availability = 'source_deleted'`, marks dependent persona-field references unavailable, sets affected approved persona versions to `needs_review` — and never deletes an approved version. Every deletion and export writes an `audit_log` row.

## Known gaps

- Malware scanning is signature-free: type/size/magic-byte checks only. A ClamAV hook point exists in `src/jobs/ingest-source.ts` but no scanner is bundled.
- Rate limiting is in-process (see above).
- No MFA in the MVP.
- Encryption at rest for the database itself is the deployment's responsibility (disk/volume encryption); the application encrypts credentials specifically.
