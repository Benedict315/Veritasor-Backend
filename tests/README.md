# Integration Tests

This directory contains integration tests for the Veritasor Backend API.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Structure

- `integration/` - Integration tests that test complete API flows
  - `auth.test.ts` - Authentication API tests (signup, login, refresh, password reset)
  - `signup-abuse-prevention.test.ts` - Signup abuse prevention, schema validation edge cases, idempotency, and timing-attack guards
  - `integrations.test.ts` - Integrations API tests (list, connect, disconnect, OAuth flow)

## Test Setup

Tests use:
- **Jest** - Test framework
- **Supertest** - HTTP assertion library for testing Express apps
- **ts-jest** - TypeScript support for Jest

## Auth Tests

The auth integration tests cover:

1. **User Signup** - Creating new user accounts
2. **User Login** - Authentication with credentials
3. **Token Refresh** - Refreshing access tokens
4. **Get Current User** - Fetching authenticated user info
5. **Forgot Password** - Initiating password reset flow
6. **Reset Password** - Completing password reset with token

### Signup Abuse Prevention Tests

`tests/integration/signup-abuse-prevention.test.ts` covers the hardened signup
service end-to-end:

- **Email validation** — format, normalization (lowercase + trim), TLD presence,
  RFC 5321 max length (254 chars)
- **Disposable email blocking** — exact match and case-insensitive match against
  the curated list in `src/utils/abusePrevention.ts`
- **Password strength** — length, character classes, common-password rejection,
  populated `details` for client diagnostics
- **Schema validation edge cases** — missing/null/undefined/non-string/empty/
  whitespace-only inputs, all surfaced as `VALIDATION_ERROR` with actionable
  `details`
- **Honeypot detection** — silent rejection of bots that populate the `website`
  field
- **Rate limiting** — per-IP, per-email, and per-headers behavior
- **Idempotency** — concurrent signups for the same email collapse to a single
  successful user; remaining attempts return generic `EMAIL_EXISTS` errors
  without leaking that the address already exists
- **Timing-attack prevention** — consistent response time for existing vs.
  non-existing emails

#### Operator Notes

- The signup service is in-memory; the rate limiter is a singleton process-wide
  store that must be reset between tests via `resetSignupRateLimitStore()`.
- All `SignupError` instances expose a typed `type` (`VALIDATION_ERROR`,
  `EMAIL_INVALID`, `EMAIL_DISPOSABLE`, `EMAIL_EXISTS`, `PASSWORD_WEAK`,
  `RATE_LIMITED`, `HONEYPOT_TRIGGERED`, `SUSPICIOUS_ACTIVITY`) plus optional
  `details: string[]`. Clients should drive UI messaging from `type`, never
  from the natural-language `message`.
- Structured logs are emitted via `src/utils/logger.ts` for the events
  `signup.validation_failed`, `signup.rate_limited`,
  `signup.duplicate_email_attempt`, `signup.duplicate_email_race`,
  `signup.success`, and `signup.unexpected_error`. None of them contain
  passwords or full email addresses — only client IP and a stable event name.
- Configuration toggles live in `DEFAULT_SIGNUP_SERVICE_CONFIG` and
  `DEFAULT_ABUSE_PREVENTION_CONFIG`; tests pass overrides through the second
  argument of `signup(...)`.

#### Threat Model Notes (Auth)

- **Email enumeration** — duplicate-email errors return `400` with a generic
  message and never use `409 Conflict`, preventing trivial enumeration through
  status-code or message inspection.
- **Timing oracles** — every code path applies `addTimingDelay` to a minimum
  operation time so an attacker cannot distinguish "user exists" from "user
  does not exist" via response latency.
- **Bot-driven signup floods** — a hidden honeypot field plus per-IP/per-email
  rate limiting with progressive delays makes credential stuffing and free
  account farming expensive.
- **Race-condition idempotency** — the service double-checks the email index
  immediately before insert. Concurrent signups racing on the same email
  collapse safely to a single created user; the remaining requests receive the
  same generic `EMAIL_EXISTS` shape as a sequential duplicate.
- **DoS via heavy hashing** — passwords are bounded by `maxPasswordLength`
  (default 128) before being passed to bcrypt to limit CPU per request.
- **PII in logs** — the structured logger never receives the password, the
  refresh token, or the access token. Email is intentionally omitted from log
  payloads to limit blast radius if logs are exfiltrated.

## Integrations Tests

The integrations integration tests cover:

1. **List Available Integrations** - Get all available integrations (public endpoint)
2. **List Connected Integrations** - Get connected integrations for authenticated business
3. **Stripe OAuth Connect** - Initiate and complete OAuth flow
4. **Disconnect Integration** - Remove integration connection
5. **Authentication** - Protected routes return 401 when unauthenticated
6. **Security** - Sensitive tokens not exposed in responses

### Mock Implementation

Currently, the tests include a mock auth router since the actual auth routes are not yet implemented. The mock:
- Uses in-memory stores for users, tokens, and reset tokens
- Simulates password hashing (prefixes with "hashed_")
- Implements proper token validation
- Follows security best practices (e.g., no email enumeration)

The integrations tests include a mock integrations router. The mock:
- Uses in-memory stores for connections and OAuth state
- Simulates OAuth flow with state generation and validation
- Implements proper authentication checks
- Follows security best practices (no token exposure, state validation)

### When Auth Routes Are Implemented

Replace the mock router in `auth.test.ts` with the actual auth router:

```typescript
// Remove createMockAuthRouter() function
// Import actual auth router
import { authRouter } from '../../src/routes/auth.js'

// In beforeAll:
app.use('/api/auth', authRouter)
```

### When Integrations Routes Are Implemented

Replace the mock router in `integrations.test.ts` with the actual integrations router:

```typescript
// Remove createMockIntegrationsRouter() function
// Import actual integrations router
import { integrationsRouter } from '../../src/routes/integrations.js'

// In beforeAll:
app.use('/api/integrations', integrationsRouter)
```

## Database Strategy

For integration tests with a real database:

1. **Test Database** - Use a separate test database
2. **Migrations** - Run migrations before tests
3. **Cleanup** - Clear data between tests
4. **Transactions** - Wrap tests in transactions and rollback

Example setup:

```typescript
beforeAll(async () => {
  await db.migrate.latest()
})

beforeEach(async () => {
  await db.raw('BEGIN')
})

afterEach(async () => {
  await db.raw('ROLLBACK')
})

afterAll(async () => {
  await db.destroy()
})
```

## Best Practices

- Test complete user flows, not just individual endpoints
- Use descriptive test names that explain the scenario
- Clean up test data between tests
- Don't expose sensitive information in error messages
- Test both success and failure cases
- Verify security requirements (401, 403, etc.)
- Test OAuth state validation and expiration
- Ensure tokens and credentials are not leaked in responses

## End-to-End (E2E) Testing Plan

The E2E tests verify the complete system flow, including the API, backend services, database, and Soroban contract interactions.

### Testing Philosophy
E2E tests should focus on the "Happy Path" user journeys and critical failure points that integration tests might miss due to mocks.

### E2E Scenarios

#### 1. Complete Attestation Lifecycle
- **Goal**: Verify a merchant can fetch revenue and submit a verified attestation on-chain.
- **Steps**:
    1. Merchant logs into the dashboard.
    2. Merchant initiates a sync for a specific period (e.g., "2025-Q1").
    3. Backend fetches data from connected integrations (Shopify/Razorpay).
    4. Backend generates a Merkle root.
    5. Backend submits the root to the Soroban contract.
    6. Verify the transaction hash is recorded and the root is queryable on the Stellar network.

#### 2. Multi-Source Integration Sync
- **Goal**: Ensure revenue data from multiple sources is correctly aggregated.
- **Steps**:
    1. User connects both Stripe and Shopify.
    2. Initiate a consolidated sync.
    3. Verify that the Merkle tree leaves contain data from both sources accurately.

### Security & Resilience Testing
- **Rate Limiting**: Verify that excessive requests from a single IP/User are throttled.
- **Idempotency**: Ensure that re-submitting an attestation with the same `Idempotency-Key` does not create duplicate on-chain transactions.
- **Auth Resilience**: Test deep-link authentication and token rotation flows.

### Performance & Scaling
- **Load Testing**: Simulate 100+ concurrent attestation submissions to ensure the Soroban RPC and DB pool can handle the load.
- **Large Dataset Aggregation**: Test sync operations with 10,000+ line items.

## Security Assumptions & Validations

The following security assumptions are baked into the system and must be validated by the E2E suite:

1. **Isolation of Business Data**:
    - *Assumption*: A user cannot sync or view revenue for a business they do not own.
    - *Validation*: E2E tests must attempt unauthorized sync requests and verify `403 Forbidden` responses.

2. **Tamper-Proof Merkle Proofs**:
    - *Assumption*: The Merkle root submitted on-chain accurately represents the source data.
    - *Validation*: Verify that changing a single revenue entry locally results in a Merkle proof mismatch against the on-chain root.

3. **Key Management**:
    - *Assumption*: Private keys are never exposed in logs or API responses.
    - *Validation*: Audit log assertions in E2E tests must scan for sensitive strings (G... or S... keys).

4. **Idempotency Integrity**:
    - *Assumption*: Multiple identical requests do not result in multiple on-chain transactions (saving gas/fees).
    - *Validation*: Check local database for single record entry after multiple POST bursts.
