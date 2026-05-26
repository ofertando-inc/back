import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  let guard: OptionalJwtAuthGuard;

  beforeEach(() => {
    guard = new OptionalJwtAuthGuard();
  });

  it('returns the authenticated user when one is available', () => {
    const user = { id: 'user-1' };

    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('returns undefined instead of throwing when auth fails', () => {
    expect(
      guard.handleRequest(new Error('invalid token'), false),
    ).toBeUndefined();
    expect(guard.handleRequest(null, null)).toBeUndefined();
  });
});
