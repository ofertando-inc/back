import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { resetTestDatabase } from './test-db';

const METRICS_TOKEN = 'metrics-scrape-token';

function extractAccessTokenCookie(setCookieHeader: unknown): string {
  const cookies = Array.isArray(setCookieHeader)
    ? (setCookieHeader as string[])
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : [];
  const cookie = cookies.find((c) => c.startsWith('access_token='));
  return cookie?.split(';')[0]?.split('=')[1] ?? '';
}

function futureIso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 3600 * 1000).toISOString();
}

describe('Metrics (e2e)', () => {
  let app: INestApplication<App>;
  let categoryId: string;

  beforeAll(async () => {
    process.env.METRICS_TOKEN = METRICS_TOKEN;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const cats = await request(app.getHttpServer()).get('/categories');
    categoryId = (cats.body as { id: string }[])[0].id;
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    delete process.env.METRICS_TOKEN;
    await app.close();
  });

  function scrape() {
    return request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', `Bearer ${METRICS_TOKEN}`);
  }

  describe('access control', () => {
    it('rejects a scrape without the bearer token', async () => {
      const response = await request(app.getHttpServer())
        .get('/metrics')
        .expect(401);

      expect((response.body as { key: string }).key).toBe('auth.unauthorized');
    });

    it('rejects a wrong token', async () => {
      await request(app.getHttpServer())
        .get('/metrics')
        .set('Authorization', 'Bearer wrong-token')
        .expect(401);
    });

    it('is open when METRICS_TOKEN is unset', async () => {
      delete process.env.METRICS_TOKEN;

      await request(app.getHttpServer()).get('/metrics').expect(200);

      process.env.METRICS_TOKEN = METRICS_TOKEN;
    });
  });

  describe('exposition', () => {
    it('exposes HTTP metrics labeled with the route pattern, plus default metrics', async () => {
      await request(app.getHttpServer()).get('/offers').expect(200);
      await request(app.getHttpServer()).get('/definitely-not-a-route');

      const response = await scrape().expect(200);
      const body = response.text;

      expect(body).toContain(
        'http_requests_total{method="GET",route="/offers",status="200"}',
      );
      expect(body).toContain('route="unmatched"');
      expect(body).toContain('http_request_duration_seconds_bucket');
      // Default process metrics are collected.
      expect(body).toContain('process_cpu_user_seconds_total');
      // The scrape endpoint itself is not counted.
      expect(body).not.toContain('route="/metrics"');
    });

    it('increments the offers business counter on creation', async () => {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'author@example.com',
          username: 'author',
          password: 'password123',
        });
      const token = extractAccessTokenCookie(registered.headers['set-cookie']);

      await request(app.getHttpServer())
        .post('/offers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Big discount',
          description: 'A very compelling discount description',
          offerType: 'discount',
          merchantName: 'Acme',
          location: { address: 'Carrera 7', city: 'Bogotá' },
          startDate: futureIso(1),
          endDate: futureIso(7),
          categoryIds: [categoryId],
        })
        .expect(201);

      const response = await scrape().expect(200);

      expect(response.text).toContain(
        'ofertando_offers_created_total{official="false"} 1',
      );
    });
  });
});
