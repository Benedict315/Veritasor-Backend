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


---

## Startup Dependency Readiness Checks

### Overview

`src/startup/readiness.ts` validates all critical dependencies **before the HTTP listener opens**. If any required check fails, `startServer()` throws and the process exits with code 1  the app never accepts traffic in a broken state.

### Checks performed (in order)

| # | Dependency | Condition | Environments |
|---|---|---|---|
| 1 | `config/jwt` | `JWT_SECRET` present and  32 chars | production |
| 1 | `config/jwt` | `JWT_SECRET` present and  8 chars | non-production |
| 2 | `config/soroban` | `SOROBAN_CONTRACT_ID` present | production only |
| 3 | `config/stripe` | `STRIPE_WEBHOOK_SECRET` present | production only |
| 4 | `database` | `SELECT 1` probe succeeds within 2.5 s | when `DATABASE_URL` is set |

### Required Environment Variables

| Variable | Required in | Reason |
|---|---|---|
| `JWT_SECRET` | All environments ( 8 chars); production ( 32 chars) | Auth token signing |
| `SOROBAN_CONTRACT_ID` | Production | Attestation contract address  omitting it would silently no-op submissions |
| `STRIPE_WEBHOOK_SECRET` | Production | Webhook signature verification  omitting it allows unsigned events |
| `DATABASE_URL` | Optional | When set, a connectivity probe is run at startup |

### Failure Modes

| Scenario | Failure reason emitted |
|---|---|
| `JWT_SECRET` not set | `JWT_SECRET is not set` |
| `JWT_SECRET` too short (dev) | `JWT_SECRET must be at least 8 characters (got N)` |
| `JWT_SECRET` too short (prod) | `JWT_SECRET must be at least 32 characters in production (got N)` |
| `SOROBAN_CONTRACT_ID` missing in prod | `SOROBAN_CONTRACT_ID must be set in production` |
| `STRIPE_WEBHOOK_SECRET` missing in prod | `STRIPE_WEBHOOK_SECRET must be set in production` |
| DB connection refused | `database connection failed: connect ECONNREFUSED [redacted]` |
| DB probe timeout | `database probe timed out after 2500 ms` |

### Security Notes

- Failure reasons **never** include secret values or raw connection strings.
- The `sanitiseDbError()` helper strips `postgres://...` and `postgresql://...` substrings from error messages before they are written to logs or the readiness report.
- The database probe is read-only (`SELECT 1`) with a 2.5-second bounded timeout.
- All readiness decisions are emitted as a single structured JSON log entry (`event: startup_readiness_report`) for log aggregation.

### Observability

Every boot emits a structured log entry:

```json
{
  "event": "startup_readiness_report",
  "ready": false,
  "env": "production",
  "checks": [
    { "dependency": "config/jwt", "ready": true },
    { "dependency": "config/soroban", "ready": false, "reason": "SOROBAN_CONTRACT_ID must be set in production" },
    { "dependency": "config/stripe", "ready": true },
    { "dependency": "database", "ready": true }
  ]
}
```

Passing checks omit the `reason` field to keep happy-path logs terse.

### Test Coverage

Tests live in `tests/integration/auth.test.ts` under the **"Startup dependency readiness checks"** describe block  22 tests:

**config/jwt** (6 tests)
- Passes in development with  8-char secret
- Fails in development with < 8-char secret (explicit reason with length)
- Fails in production when `JWT_SECRET` is missing
- Fails in production when `JWT_SECRET` is < 32 chars (explicit reason with length)
- Passes in production with exactly 32-char secret
- Fails when `JWT_SECRET` is whitespace-only

**config/soroban** (3 tests)
- Passes in non-production regardless of `SOROBAN_CONTRACT_ID`
- Fails in production when `SOROBAN_CONTRACT_ID` is missing
- Passes in production when `SOROBAN_CONTRACT_ID` is set

**config/stripe** (3 tests)
- Passes in non-production regardless of `STRIPE_WEBHOOK_SECRET`
- Fails in production when `STRIPE_WEBHOOK_SECRET` is missing
- Passes in production when `STRIPE_WEBHOOK_SECRET` is set

**database** (3 tests)
- Skips check when `DATABASE_URL` is not configured
- Marks down with explicit reason when connection is refused
- Marks down with timeout reason when probe times out

**report structure** (5 tests)
- All four dependency names present in checks array
- `ready: false` when any single check fails
- `ready: true` when all checks pass in development
- Passing checks have no `reason` field
- Failure reasons never contain the raw `DATABASE_URL` value

**sanitiseDbError** (4 tests)
- Redacts `postgres://` connection strings
- Redacts `postgresql://` connection strings
- Leaves messages without a connection string unchanged
- Case-insensitive scheme matching

### Threat Model Notes

**Auth (`config/jwt`):** A short or absent `JWT_SECRET` in production would allow tokens to be forged with a brute-forced or guessed secret. The 32-character minimum provides  128 bits of entropy for HMAC-SHA256.

**Webhooks (`config/stripe`):** Without `STRIPE_WEBHOOK_SECRET`, the webhook endpoint cannot verify HMAC signatures and would accept any unsigned POST as a legitimate Stripe event. Blocking startup prevents this misconfiguration from reaching production.

**Integrations (`config/soroban`):** An empty `SOROBAN_CONTRACT_ID` would cause attestation submissions to target no contract, silently discarding on-chain writes. Blocking startup surfaces this before any merchant data is processed.

**Database:** The startup probe uses a read-only `SELECT 1` query with a 2.5-second timeout. It does not expose the connection string in logs or error messages  credentials are redacted by `sanitiseDbError()`.
