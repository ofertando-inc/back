import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const packageVersion = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live answers 200 with a minimal body', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /health answers 200 with the Terminus format and the meta block', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    const body = response.body as {
      status: string;
      details: {
        database: { status: string };
        memory_heap: { status: string };
      };
      meta: { version: string; environment: string; uptime: number };
    };

    expect(body.status).toBe('ok');
    expect(body.details.database.status).toBe('up');
    expect(body.details.memory_heap.status).toBe('up');
    expect(body.meta.version).toBe(packageVersion);
    expect(body.meta.environment).toBe('test');
    expect(body.meta.uptime).toBeGreaterThanOrEqual(0);
  });
});
