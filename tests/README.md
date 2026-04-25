# Tests — Veritasor Backend

This directory contains unit and integration tests for the Veritasor Backend API.

---

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

---

## Test Structure

- `integration/` - Integration tests that test complete API flows
  - `auth.test.ts` - Authentication API tests (signup, login, refresh, password reset)
  - `integrations.test.ts` - Integrations API tests (list, connect, disconnect, OAuth flow)
- `unit/` - Unit tests for individual modules and services
  - `services/revenue/` - Revenue service tests
    - `normalize.test.ts` - Revenue data normalization tests
    - `revenueReportSchema.test.ts` - Revenue report schema validation and security tests

---

## Unit Tests — Revenue Services

### `normalize.test.ts`

Covers two source files:

| Module | Function | Description |
|--------|----------|-------------|
| `normalize.ts` | `normalizeRevenueEntry` | Canonical shape, currency/date/amount edge cases |
| `normalize.ts` | `detectNormalizationDrift` | Batch drift detection against a statistical baseline |
| `anomalyDetection.ts` | `detectRevenueAnomaly` | MoM anomaly scoring with configurable thresholds |
| `anomalyDetection.ts` | `calibrateFromSeries` | Derive thresholds from historical training data |

#### Coverage target

≥ 95% line and branch coverage on all touched modules where practical.
Run `npm run test:coverage` to verify; the coverage report is emitted to `coverage/`.

---

## Anomaly Detection — Operator Tuning

### Environment Variables

All threshold defaults for `detectRevenueAnomaly` and `calibrateFromSeries` can be
overridden at process start via environment variables. Set them in `.env` (copy from
`.env.example`) before the service boots; changes take effect on the next restart.

| Variable | Type | Default | Description |
|---|---|---|---|
| `ANOMALY_DROP_THRESHOLD` | float | `0.4` | MoM fractional drop that triggers `unusual_drop`. E.g. `0.3` = flag when revenue falls ≥ 30%. Must be in `(0, 1]`. |
| `ANOMALY_SPIKE_THRESHOLD` | float | `3.0` | MoM fractional rise that triggers `unusual_spike`. E.g. `2.0` = flag when revenue rises ≥ 200%. Must be `> 0`. |
| `ANOMALY_MIN_DATA_POINTS` | int | `2` | Minimum series length required for detection. Must be an integer `≥ 2`. |
| `ANOMALY_CALIBRATION_SIGMA` | float | `2.0` | Std-dev multiplier used by `calibrateFromSeries`. Must be `> 0`. |

**Validation behaviour** — if an env-var value fails validation (wrong type, out of
range, empty string), the module falls back silently to the hard-coded default and
emits a warning to `stderr`. No exception is thrown.

Example `.env` entries:

```dotenv
ANOMALY_DROP_THRESHOLD=0.30
ANOMALY_SPIKE_THRESHOLD=2.00
ANOMALY_MIN_DATA_POINTS=3
ANOMALY_CALIBRATION_SIGMA=2.5
```

---

### Calibration API

Use `calibrateFromSeries` to derive statistically-grounded thresholds from at least
12 months of historical revenue data and then pass the result into
`detectRevenueAnomaly`:

```ts
import { calibrateFromSeries, detectRevenueAnomaly } from './src/services/revenue/anomalyDetection.js';

const cal = calibrateFromSeries(historicalSeries, { sigmaMultiplier: 2 });
const result = detectRevenueAnomaly(currentSeries, cal);
```

## Soroban RPC Client Configuration

The Soroban RPC client includes comprehensive timeout, retry, and resilience configuration for production deployments.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint URL |
| `SOROBAN_CONTRACT_ID` | Required | Deployed attestation contract address (C...) |
| `SOROBAN_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Stellar network passphrase |
| `SOROBAN_RPC_TIMEOUT_MS` | `5000` | Timeout for individual RPC requests (100-60000ms) |
| `SOROBAN_RPC_MAX_RETRIES` | `2` | Maximum retry attempts after initial failure (0-5) |
| `SOROBAN_RPC_RETRY_BASE_DELAY_MS` | `200` | Base delay for exponential backoff (1-30000ms) |
| `SOROBAN_RPC_RETRY_MAX_DELAY_MS` | `1500` | Maximum delay for exponential backoff (1-30000ms) |
| `SOROBAN_RPC_RETRY_JITTER_RATIO` | `0.2` | Jitter ratio to reduce synchronized retries (0-1) |
| `SOROBAN_RPC_CIRCUIT_BREAKER_THRESHOLD` | `5` | Consecutive failures before opening circuit breaker (1-20) |
| `SOROBAN_RPC_CIRCUIT_BREAKER_RESET_MS` | `30000` | Time before attempting to close circuit breaker (1000-300000ms) |

### Resilience Features

- **Timeout Protection**: Individual requests timeout to prevent hanging
- **Exponential Backoff**: Delays increase exponentially with jitter to reduce thundering herd
- **Circuit Breaker**: Prevents cascading failures by temporarily rejecting requests when service is unhealthy
- **Enhanced Error Classification**: Retries DNS failures, stale connections, and rate limits
- **Observability Hooks**: Structured logging and metrics collection for monitoring

### Security Considerations

- No sensitive data (keys, tokens) is logged
- Circuit breaker prevents resource exhaustion attacks
- Rate limit awareness prevents 429 response cascades
- Request IDs enable distributed tracing

### Monitoring

The client emits structured logs for:
- Request start/completion with timing
- Retry attempts with delay information
- Circuit breaker state changes
- Transport failures with error classification

Use observability hooks for custom metrics collection:

```typescript
const hooks: SorobanObservabilityHooks = {
  onRequestSuccess: (op, attempt, duration) => {
    metrics.record(`soroban.${op}.success`, duration)
  },
  onRequestFailure: (op, attempt, duration, error) => {
    metrics.record(`soroban.${op}.failure`, { duration, error: error.message })
  },
  onCircuitBreakerStateChange: (oldState, newState) => {
    logger.info('Circuit breaker state changed', { oldState, newState })
  }
}
```

---

## Security — Threat Model Notes

### Anomaly Detection

#### Spike Attacks
An adversary submitting artificially inflated revenue figures (to obscure a real
drop later) will surface as `unusual_spike` first. Pair anomaly detection with
source-level webhook signature verification so that only authenticated payloads
reach `detectRevenueAnomaly`.

#### Replay Attacks on Baselines
`calibrateFromSeries` is a pure function — it does not persist state. Callers are
responsible for persisting and versioning `CalibrationResult` objects. An attacker
who can force a recalibration using manipulated historical data could widen
thresholds and suppress future anomaly flags. Store calibration results under
authenticated access control and avoid accepting untrusted series as training data.

#### Env-Var Injection
Threshold env vars are read once at module load and validated strictly. An attacker
who can modify process environment variables before boot could widen thresholds.
Treat your deployment secrets and runtime environment accordingly.

#### Log Injection
The `detail` string in `AnomalyResult` and the `AnomalyLogRecord` payload embed
`period` and `amount` values from the caller-supplied input series. Ensure your log
aggregator escapes or sanitises these fields before rendering them in dashboards
or alert messages.

### Auth Routes

- JWT tokens must be validated on every request; user existence is re-verified
  against the database to detect revoked accounts.
- Rate limiting is applied per route bucket (see `src/middleware/rateLimiter.ts`);
  auth endpoints (login, refresh, forgot-password, reset-password) use named buckets
  so bursts against one endpoint cannot exhaust the shared budget for another.
- Password reset tokens must be single-use and short-lived (< 15 minutes).
- Signup uses a dedicated abuse-prevention limiter stricter than the shared bucket.

### Webhooks & Integrations

- OAuth state parameters must be validated and be single-use to prevent CSRF.
- Integration tokens and credentials must never appear in API responses or logs;
  the E2E suite includes sensitive-string assertions to enforce this.
- Idempotency keys on attestation submissions prevent duplicate on-chain
  transactions under burst conditions.

---

## Integration Tests

### Auth Tests (`integration/auth.test.ts`)

| Scenario | Description |
|---|---|
| User Signup | Creating new user accounts |
| User Login | Authentication with credentials |
| Token Refresh | Refreshing access tokens |
| Get Current User | Fetching authenticated user info |
| Forgot Password | Initiating password reset flow |
| Reset Password | Completing password reset with token |

### Integrations Tests (`integration/integrations.test.ts`)

| Scenario | Description |
|---|---|
| List Available Integrations | Get all available integrations (public endpoint) |
| List Connected Integrations | Get connected integrations for authenticated business |
| Stripe OAuth Connect | Initiate and complete OAuth flow |
| Disconnect Integration | Remove integration connection |
| Authentication | Protected routes return 401 when unauthenticated |
| Security | Sensitive tokens not exposed in responses |

### Mock Implementation

Auth and integrations tests use in-memory mock routers until the real routes are
implemented. To switch to real routes, see the comments at the top of each test file.

---

## Database Strategy

For integration tests with a real database:

```typescript
beforeAll(async () => {
  await db.migrate.latest();
});

beforeEach(async () => {
  await db.raw('BEGIN');
});

afterEach(async () => {
  await db.raw('ROLLBACK');
});

afterAll(async () => {
  await db.destroy();
});
```

## Revenue Report Schema Tests

The revenue report schema tests (`revenueReportSchema.test.ts`) cover comprehensive validation and security hardening for the `/api/analytics/revenue` endpoint query parameters.

### Security Validation Coverage

1. **Input Format Validation**
   - Strict YYYY-MM format enforcement
   - Year boundary validation (2020-2105)
   - Month range validation (01-12)
   - Length limits to prevent DoS attacks

2. **Injection Prevention**
   - HTML/Script injection attempts
   - SQL injection patterns
   - Command injection attempts
   - Path traversal attacks
   - XSS attempts with various encodings

3. **Parameter Combination Validation**
   - Period vs range parameter conflicts
   - Required parameter combinations
   - Mutual exclusivity enforcement

4. **Edge Case Testing**
   - Boundary conditions (min/max years)
   - Malformed date strings
   - Unicode and null byte attacks
   - Extremely long strings

### Test Categories

- **Valid Inputs**: Ensure legitimate requests pass validation
- **Invalid Format**: Reject malformed date strings
- **Year Boundaries**: Enforce reasonable year limits
- **Month Validation**: Proper month format and range
- **Injection Prevention**: Block various attack vectors
- **Parameter Combinations**: Validate parameter relationships
- **DoS Prevention**: Prevent resource exhaustion attacks
- **Error Types**: Verify structured error constants

## Best Practices

- Test complete user flows, not just individual endpoints
- Use descriptive test names that explain the scenario
- Clean up test data between tests
- Don't expose sensitive information in error messages
- Test both success and failure cases
- Verify security requirements (401, 403, etc.)
- Test OAuth state validation and expiration
- Ensure tokens and credentials are not leaked in responses
- Include comprehensive negative testing for security-critical endpoints
- Test boundary conditions and edge cases thoroughly
- Validate input sanitization and injection prevention

## Error Envelope Snapshot Coverage

`integration/auth.test.ts` includes snapshot tests for the global error handler
client shape. These tests pin the stable envelope fields:

- `status: "error"`
- `code` from `src/types/errors.ts`
- client-safe `message`
- optional `details` for validation failures, plus legacy `errors` alias for
  existing validation clients
- `timestamp` and `requestId`

The snapshots cover direct Zod errors, PostgreSQL constraint and operational
errors, and non-`Error` throwables. Timestamps and request IDs are normalized in
the snapshot helper so the tests assert contract shape rather than runtime
entropy.

## Threat Model Notes

- **Auth**: login, refresh, password reset, and current-user failures must keep
  credential, token, and user-enumeration details out of responses. Server-side
  logs should include request method, path, request ID, status code, and typed
  error metadata for triage without recording request bodies or secrets.
- **Webhooks**: malformed payloads, signature failures, replay attempts, and
  provider downtime should return typed, generic envelopes. Logs may include
  provider name, request ID, and verification outcome, but never webhook secrets,
  raw signatures, payment tokens, or full provider payloads.
- **Integrations**: OAuth state mismatches, token exchange failures, and provider
  API errors should preserve stable client codes while redacting access tokens,
  refresh tokens, API keys, merchant credentials, and database connection
  details from both API responses and routine structured logs.

- Test complete user flows, not just individual endpoints.
- Use descriptive test names that document the expected scenario.
- Clean up test data between tests; never rely on test ordering.
- Do not expose sensitive information (tokens, keys, passwords) in error messages
  or test assertions.
- Test both success and failure cases, including boundary conditions.
- Verify security requirements (401, 403, rate-limit headers, etc.).
- Test OAuth state validation and expiration.
- Ensure tokens and credentials are not leaked in responses.

---

## End-to-End (E2E) Testing Plan

### Scenarios

#### 1. Complete Attestation Lifecycle
1. Merchant logs in and initiates a sync for a specific period.
2. Backend fetches data from connected integrations (Shopify / Razorpay).
3. Backend generates a Merkle root.
4. Backend submits the root to the Soroban contract.
5. Verify the transaction hash is recorded and the root is queryable on Stellar.

#### 2. Multi-Source Integration Sync
1. User connects both Stripe and Shopify.
2. Initiate a consolidated sync.
3. Verify Merkle tree leaves contain data from both sources accurately.

### Security & Resilience

- **Rate Limiting** — verify excessive requests from a single IP/user are throttled.
- **Idempotency** — re-submitting an attestation with the same `Idempotency-Key`
  must not create duplicate on-chain transactions.
- **Auth Resilience** — test deep-link auth and token rotation flows.

### Performance & Scaling

- **Load Testing** — 100+ concurrent attestation submissions.
- **Large Dataset Aggregation** — sync with 10 000+ line items.

### Security Assumptions

4. **Idempotency Integrity**:
    - *Assumption*: Multiple identical requests do not result in multiple on-chain transactions (saving gas/fees).
    - *Validation*: Check local database for single record entry after multiple POST bursts.
    
## Read Consistency & Security

Veritasor implements a multi-tier consistency model for reading attestations to balance performance and security.

### Consistency Levels

1.  **LOCAL (Default)**:
    -   Reads directly from the PostgreSQL database.
    -   Lowest latency, suitable for most dashboard views.
    -   Subject to indexing lag (DB might be a few blocks behind the chain).

2.  **STRONG**:
    -   Reads from the DB and then verifies the record against the Soroban blockchain state.
    -   Higher latency (requires RPC calls).
    -   Guarantees the data matches the "Truth on Chain".
    -   Used for critical audits and legal proof generation.

### Threat Model & Resilience Notes

| Threat | Strategy | Mechanism |
| :--- | :--- | :--- |
| **Indexing Lag** | Detection & Auto-Correction | If a STRONG read finds a record on-chain that is still marked as `pending` in the DB, the system auto-updates the DB to `confirmed`. |
| **Data Tampering** | Integrity Verification | If a STRONG read detects a Merkle root mismatch between the DB and the Chain, it logs a CRITICAL CONSISTENCY ERROR for immediate operator review. |
| **Revocation Propagation** | Immediate Verification | STRONG reads ensure that if an attestation is revoked on-chain, it is treated as revoked by the system regardless of DB state. |
| **Network Outage** | Graceful Degradation | If the Soroban RPC is unavailable during a STRONG read, the system falls back to LOCAL data and logs a warning. |

### Operator Runbook: Discrepancies

If a `CRITICAL CONSISTENCY ERROR` is observed in logs:
1.  Verify the on-chain data using a block explorer or `stellar-cli`.
2.  Check the database for unauthorized modifications.
3.  Initiate a manual re-sync if the DB record is corrupted.

## Email Security & Template Hardening

The email service implements strict validation and sanitization to prevent injection attacks.

### Injection Prevention

1.  **Input Validation (Zod)**:
    -   All emails are validated against the `z.string().email()` schema.
    -   Reset links are validated to ensure they use safe protocols (`https:` or `http:` in dev). Unsafe protocols like `javascript:` or `data:` are rejected.

2.  **HTML Escaping**:
    -   All dynamic values interpolated into HTML templates are escaped using a dedicated `escapeHtml` utility.
    -   This prevents attackers from injecting malicious HTML tags (e.g., `<script>`, `<iframe>`, `<img>`) even if they manage to partially control the link or other parameters.

### Threat Model: Email Risks

| Threat | Strategy | Mechanism |
| :--- | :--- | :--- |
| **HTML Injection** | Sanitization | `escapeHtml` converts `<`, `>`, `&`, `"`, and `'` into entities. |
| **Link Wrapping/Phishing** | Protocol Gating | Only allowed protocols are permitted; others trigger a validation error. |
| **Header Injection** | SMTP Library Safety | Use of `nodemailer` which handles header sanitization internally, combined with Zod validation of the `to` field. |
| **Information Leakage** | Dev Stubs | In development mode, reset links are logged to the console instead of sent, and the `to` address is never leaked in unauthorized contexts. |
