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
  - `cors.test.ts` - CORS middleware tests (allowlist, wildcard, preflight, credentials, logging)
  - `integrations.test.ts` - Integrations API tests (list, connect, disconnect, OAuth flow)
- `unit/` - Unit tests for individual modules
  - `cors.test.ts` - `getAllowedOrigins()` parsing and environment-specific behaviour
  - `routeMap.test.ts` - Route map generation logic from Express router stack

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

## CORS Tests

The CORS tests verify the `createCorsMiddleware()` behaviour from `src/middleware/cors.ts`.

### Integration tests (`integration/cors.test.ts`)

| Scenario | Assertion |
|---|---|
| Request from allowed origin | `Access-Control-Allow-Origin` matches the origin |
| Request from disallowed origin | No `Access-Control-Allow-Origin` header |
| Preflight (OPTIONS) from allowed origin | 204, correct methods, max-age, credentials |
| Preflight from disallowed origin | No CORS headers |
| No `Origin` header (same-origin) | Request succeeds normally |
| Credentials with allowlist | `Access-Control-Allow-Credentials: true` |
| Wildcard mode (dev) | Origin reflected, no credentials header |
| Exposed headers | `X-Request-ID` in `Access-Control-Expose-Headers` |
| Structured logging | `cors_rejected` log emitted for blocked origins |

### Unit tests (`unit/cors.test.ts`)

| Scenario | Expected |
|---|---|
| `ALLOWED_ORIGINS` set | Parsed array |
| `ALLOWED_ORIGINS` unset + production | `[]` |
| `ALLOWED_ORIGINS` unset + development | `"*"` |
| Extra whitespace / trailing commas | Trimmed, empty segments removed |

## Configuration Environment Variables

The application uses Zod for strict runtime validation of environment variables. If any required variable is missing or invalid, the application will **fail fast** at startup.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Environment mode (`development`, `production`, `test`). |
| `DATABASE_URL` | **Yes** | - | PostgreSQL connection string (e.g. `postgres://user:pass@localhost:5432/db`). |
| `JWT_SECRET` | **Prod: yes** | Dev: fallback | Secret key for JWT signing. In production, must be at least 32 characters. |
| `ALLOWED_ORIGINS` | **Prod: yes** | Dev: `*` | Comma-separated list of allowed CORS origins. |
| `STELLAR_NETWORK` | No | `testnet` | Stellar network (`testnet`, `public`, `futurenet`). |
| `SOROBAN_RPC_URL` | No | Testnet URL | Soroban RPC endpoint. |
| `SOROBAN_CONTRACT_ID` | No | - | Deployed attestation contract address (C...). |

### Behaviour by environment

- **Development**: Missing `JWT_SECRET` triggers a warning and uses an unsafe default secret. Missing `DATABASE_URL` causes startup failure.
- **Production**: Missing `ALLOWED_ORIGINS` or a weak `JWT_SECRET` (< 32 chars) causes immediate startup failure.

## Threat Model Notes

### Authentication & Secrets
- **JWT Secrets**: The application enforces a minimum entropy requirement (32 chars) for `JWT_SECRET` in production to resist brute-force attacks.
- **Dev Fallbacks**: While dev fallbacks are provided for ease of use, they are explicitly disabled in production mode to prevent accidental deployment with insecure defaults.
- **Fail-Fast**: By validating configuration at the earliest possible stage (module import), we prevent the application from running in a partially-configured or insecure state.

### Webhooks & Integrations
- **URL Validation**: Integration endpoints (like `SOROBAN_RPC_URL`) are validated as proper URLs to prevent SSRF or misdirection via malformed config.
- **Network Isolation**: `STELLAR_NETWORK` is strictly enforced to prevent accidentally connecting a production instance to a testnet contract or vice-versa.

### CORS & Browser Security
- **Explicit Allowlist**: Production environments require an explicit `ALLOWED_ORIGINS` list. Wildcards (`*`) are rejected in production to prevent unauthorized cross-origin access to sensitive data.
- **Credential Protection**: Credentials (cookies/headers) are only allowed when a specific origin matches the allowlist, preventing ambient-authority exploitation.

## Observability
- **Structured Logs**: Configuration validation failures are logged as structured JSON errors via the internal `logger.error` utility, including specific details on which fields failed validation.

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
