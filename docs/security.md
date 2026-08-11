# Security and privacy

- Authentication uses server-side sessions. State-changing forms require CSRF validation.
- Membership roles are owner, admin, editor, and viewer. Editors can upload, generate, edit, and export; viewers are read-only and may export.
- Project reads and writes resolve both organization membership and project ownership. IDs supplied by the browser are never trusted as authorization.
- Integration credentials are encrypted at rest with AES-256-GCM and are never returned to the browser.
- Uploaded research is parsed server-side. Pattern-based redaction removes common email, phone, payment-card, government-ID, and address-like data before OpenAI processing.
- Automated PII detection is best effort and is not a substitute for legal or compliance review.
- CSV export uses RFC 4180 quoting and prefixes formula-leading cells to reduce spreadsheet injection risk.
- Live vendor failures never trigger an automatic mock fallback.
- Upload size, file type, rate limits, duplicate hashes, and storage keys are validated before processing.
