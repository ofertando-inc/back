process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3001';
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/ofertando_test?schema=public';
process.env.JWT_SECRET ??= 'test_jwt_secret';
process.env.JWT_EXPIRES_IN ??= '1d';
