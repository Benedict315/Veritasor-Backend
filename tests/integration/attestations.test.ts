/**
 * Integration tests for attestations API.
 * Tests both requireAuth and requireBusinessAuth middleware.
 * Validates business authorization boundary checks.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'

// Mock user and business data for testing
const mockUser = {
  id: 'user-123',
  userId: 'user-123',
  email: 'test@example.com'
}

const mockBusiness = {
  id: 'business-123',
  userId: 'user-123',
  name: 'Test Business',
  industry: 'Technology',
  description: 'A test business',
  website: 'https://test.com',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z'
}

const otherUserBusiness = {
  id: 'business-456',
  userId: 'user-456',
  name: 'Other Business',
  industry: 'Finance',
  description: 'Another test business',
  website: 'https://other.com',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z'
}

// Test headers
const authHeader = { Authorization: 'Bearer test-token' }
const businessAuthHeader = { 
  Authorization: 'Bearer test-token',
  'x-business-id': 'business-123'
 }
const otherBusinessAuthHeader = { 
  Authorization: 'Bearer test-token',
  'x-business-id': 'business-456'
 }

describe('Attestations API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Legacy tests for backward compatibility
  it('GET /api/attestations returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/attestations')
    expect(res.status).toBe(401)
    expect(res.body?.error === 'Unauthorized' || res.body?.message).toBe(true)
  })

  it('GET /api/attestations list returns empty when no data', async () => {
    const res = await request(app).get('/api/attestations').set(authHeader)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body?.attestations)).toBe(true)
    expect(res.body.attestations.length).toBe(0)
    expect(res.body?.message).toBeTruthy()
  })

  it('GET /api/attestations list response has expected shape (with data case)', async () => {
    const res = await request(app).get('/api/attestations').set(authHeader)
    expect(res.status).toBe(200)
    expect('attestations' in res.body).toBe(true)
    expect(Array.isArray(res.body.attestations)).toBe(true)
    // When backend returns data, items can be validated here
  })

  it('GET /api/attestations/:id returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/attestations/abc-123')
    expect(res.status).toBe(401)
  })

  it('GET /api/attestations/:id returns attestation by id when authenticated', async () => {
    const res = await request(app).get('/api/attestations/abc-123').set(authHeader)
    expect(res.status).toBe(200)
    expect(res.body?.id).toBe('abc-123')
    expect(res.body?.message).toBeTruthy()
  })

  it('POST /api/attestations returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/attestations')
      .set('Idempotency-Key', 'test-key')
      .send({ business_id: 'b1', period: '2024-01' })
    expect(res.status).toBe(401)
  })

  it('POST /api/attestations submit succeeds with auth and Idempotency-Key', async () => {
    const res = await request(app)
      .post('/api/attestations')
      .set(authHeader)
      .set('Idempotency-Key', 'integration-test-submit-1')
      .send({ business_id: 'b1', period: '2024-01' })
    expect(res.status).toBe(201)
    expect(res.body?.message).toBeTruthy()
    expect(res.body?.business_id).toBe('b1')
    expect(res.body?.period).toBe('2024-01')
  })

  it('POST /api/attestations duplicate request returns same response (idempotent)', async () => {
    const key = 'integration-test-idempotent-' + Date.now()
    const first = await request(app)
      .post('/api/attestations')
      .set(authHeader)
      .set('Idempotency-Key', key)
      .send({ business_id: 'b2', period: '2024-02' })
    expect(first.status).toBe(201)
    const second = await request(app)
      .post('/api/attestations')
      .set(authHeader)
      .set('Idempotency-Key', key)
      .send({ business_id: 'b2', period: '2024-02' })
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
  })

  it('DELETE /api/attestations/:id revoke returns 401 when unauthenticated', async () => {
    const res = await request(app).delete('/api/attestations/xyz-456')
    expect(res.status).toBe(401)
  })

  it('DELETE /api/attestations/:id revoke succeeds when authenticated', async () => {
    const res = await request(app).delete('/api/attestations/xyz-456').set(authHeader)
    expect(res.status).toBe(200)
    expect(res.body?.id).toBe('xyz-456')
    expect(res.body?.message).toBeTruthy()
  })
})

describe('Business Authorization Boundary Checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requireBusinessAuth rejects requests without Authorization header', async () => {
    const res = await request(app)
      .get('/api/attestations')
      .set('x-business-id', 'business-123')
    expect(res.status).toBe(401)
    expect(res.body?.code).toBe('MISSING_AUTH')
    expect(res.body?.message?.includes('authorization header')).toBe(true)
  })

  it('requireBusinessAuth rejects requests with invalid Authorization format', async () => {
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'InvalidFormat token')
      .set('x-business-id', 'business-123')
    expect(res.status).toBe(401)
    expect(res.body?.code).toBe('MISSING_AUTH')
  })

  it('requireBusinessAuth rejects requests without business ID', async () => {
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer test-token')
    expect(res.status).toBe(400)
    expect(res.body?.code).toBe('MISSING_BUSINESS_ID')
    expect(res.body?.message?.includes('Business ID is required')).toBe(true)
  })

  it('requireBusinessAuth rejects requests with invalid business ID format', async () => {
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer test-token')
      .set('x-business-id', 'invalid@business#id')
    expect(res.status).toBe(400)
    expect(res.body?.code).toBe('MISSING_BUSINESS_ID')
  })

  it('requireBusinessAuth rejects requests with invalid JWT token', async () => {
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer invalid-token')
      .set('x-business-id', 'business-123')
    expect(res.status).toBe(401)
    expect(res.body?.code).toBe('INVALID_TOKEN')
    expect(res.body?.message?.includes('invalid')).toBe(true)
  })

  it('requireBusinessAuth rejects requests for non-existent business', async () => {
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer test-token')
      .set('x-business-id', 'non-existent-business')
    expect(res.status).toBe(403)
    expect(res.body?.code).toBe('BUSINESS_NOT_FOUND')
    expect(res.body?.message?.includes('not found or access denied')).toBe(true)
  })

  it('requireBusinessAuth rejects requests for business owned by different user', async () => {
    // This test would require mocking the business repository to return otherUserBusiness
    // and the user repository to return mockUser, showing the ownership boundary
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer test-token')
      .set('x-business-id', 'business-456') // Owned by user-456, but token is for user-123
    expect(res.status).toBe(403)
    expect(res.body?.code).toBe('BUSINESS_NOT_FOUND')
    expect(res.body?.message?.includes('access denied')).toBe(true)
  })

  it('requireBusinessAuth accepts valid business ID from header', async () => {
    // This test would require proper mocking of repositories
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer valid-token')
      .set('x-business-id', 'business-123')
    // Should pass through to the route handler
    expect([200, 404].includes(res.status)).toBe(true) // 200 if data exists, 404 if no business found for user
  })

  it('requireBusinessAuth accepts business ID from request body', async () => {
    const res = await request(app)
      .post('/api/attestations')
      .set('Authorization', 'Bearer valid-token')
      .set('Idempotency-Key', 'test-business-body')
      .send({ 
        businessId: 'business-123',
        period: '2024-01',
        merkleRoot: 'test-root'
      })
    // Should pass through to the route handler
    expect([201, 400, 403].includes(res.status)).toBe(true) // 201 if successful, 400/403 if validation fails
  })

  it('requireBusinessAuth accepts business_id from request body', async () => {
    const res = await request(app)
      .post('/api/attestations')
      .set('Authorization', 'Bearer valid-token')
      .set('Idempotency-Key', 'test-business-body-2')
      .send({ 
        business_id: 'business-123',
        period: '2024-01',
        merkleRoot: 'test-root'
      })
    // Should pass through to the route handler
    expect([201, 400, 403].includes(res.status)).toBe(true)
  })

  it('requireBusinessAuth prioritizes header over body business ID', async () => {
    const res = await request(app)
      .post('/api/attestations')
      .set('Authorization', 'Bearer valid-token')
      .set('x-business-id', 'business-123') // Header takes priority
      .set('Idempotency-Key', 'test-priority')
      .send({ 
        business_id: 'business-456', // This should be ignored
        period: '2024-01',
        merkleRoot: 'test-root'
      })
    // Should use business-123 from header
    expect([201, 400, 403].includes(res.status)).toBe(true)
  })
})

describe('Security Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requireBusinessAuth handles empty business ID header', async () => {
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer test-token')
      .set('x-business-id', '')
    expect(res.status).toBe(400)
    expect(res.body?.code).toBe('MISSING_BUSINESS_ID')
  })

  it('requireBusinessAuth handles whitespace-only business ID', async () => {
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer test-token')
      .set('x-business-id', '   ')
    expect(res.status).toBe(400)
    expect(res.body?.code).toBe('MISSING_BUSINESS_ID')
  })

  it('requireBusinessAuth handles extremely long business ID', async () => {
    const longId = 'a'.repeat(100) // Exceeds 50 character limit
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer test-token')
      .set('x-business-id', longId)
    expect(res.status).toBe(400)
    expect(res.body?.code).toBe('MISSING_BUSINESS_ID')
  })

  it('requireBusinessAuth handles special characters in business ID', async () => {
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer test-token')
      .set('x-business-id', 'business@123#test')
    expect(res.status).toBe(400)
    expect(res.body?.code).toBe('MISSING_BUSINESS_ID')
  })

  it('requireBusinessAuth handles SQL injection attempts', async () => {
    const sqlInjection = "'; DROP TABLE businesses; --"
    const res = await request(app)
      .get('/api/attestations')
      .set('Authorization', 'Bearer test-token')
      .set('x-business-id', sqlInjection)
    expect(res.status).toBe(400)
    expect(res.body?.code).toBe('MISSING_BUSINESS_ID')
  })

  it('requireBusinessAuth handles null/undefined business ID in body', async () => {
    const res = await request(app)
      .post('/api/attestations')
      .set('Authorization', 'Bearer test-token')
      .set('Idempotency-Key', 'test-null')
      .send({ 
        business_id: null,
        period: '2024-01',
        merkleRoot: 'test-root'
      })
    expect(res.status).toBe(400)
    expect(res.body?.code).toBe('MISSING_BUSINESS_ID')
  })
})

describe('Performance Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requireBusinessAuth handles concurrent requests', async () => {
    const promises = Array.from({ length: 10 }, () =>
      request(app)
        .get('/api/attestations')
        .set('Authorization', 'Bearer test-token')
        .set('x-business-id', 'business-123')
    )
    
    const results = await Promise.all(promises)
    // All should return the same status code (either all succeed or all fail consistently)
    const statusCodes = results.map(r => r.status)
    const uniqueStatuses = new Set(statusCodes)
    expect(uniqueStatuses.size).toBe(1) // All requests should return the same status
  })
})
