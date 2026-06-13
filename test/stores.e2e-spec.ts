import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { GeocodingService } from '../src/stores/geocoding.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './test-db';

type RegisteredUser = { accessToken: string; user: { id: string } };
type StoreBody = {
  id: string;
  name: string;
  city: string;
  verified: boolean;
  latitude: number | null;
  longitude: number | null;
};
type ErrorBody = { key: string };

const geocodeStub = {
  search: jest.fn().mockResolvedValue([
    {
      displayName: 'Carrera 7, Bogotá, Colombia',
      latitude: 4.61,
      longitude: -74.08,
      city: 'Bogotá',
      region: 'Bogotá',
      address: 'Carrera 7',
    },
  ]),
};

function extractAccessTokenCookie(setCookieHeader: unknown): string {
  const cookies = Array.isArray(setCookieHeader)
    ? (setCookieHeader as string[])
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : [];
  const cookie = cookies.find((c) => c.startsWith('access_token='));
  return cookie?.split(';')[0]?.split('=')[1] ?? '';
}

function futureIso(days: number): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
}

describe('Stores flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let categoryId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GeocodingService)
      .useValue(geocodeStub)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    const cats = await request(app.getHttpServer()).get('/categories');
    categoryId = (cats.body as { id: string }[])[0].id;
  });

  beforeEach(async () => {
    await resetTestDatabase();
    geocodeStub.search.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerUser(
    email: string,
    username: string,
  ): Promise<RegisteredUser> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, username, password: 'password123' });
    return {
      accessToken: extractAccessTokenCookie(res.headers['set-cookie']),
      user: res.body as RegisteredUser['user'],
    };
  }

  async function registerAdmin(
    email: string,
    username: string,
  ): Promise<RegisteredUser> {
    const admin = await registerUser(email, username);
    await prisma.user.update({
      where: { id: admin.user.id },
      data: { role: UserRole.ADMIN },
    });
    return admin;
  }

  function createStore(
    token: string,
    body: Record<string, unknown>,
  ): request.Test {
    return request(app.getHttpServer())
      .post('/stores')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function createOffer(token: string, storeId?: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'An offer',
        description: 'A very compelling description',
        offerType: 'discount',
        storeName: 'Acme',
        city: 'Bogotá',
        startDate: futureIso(1),
        endDate: futureIso(7),
        categoryIds: [categoryId],
        ...(storeId ? { storeId } : {}),
      });
    return (res.body as { id: string }).id;
  }

  describe('GET /stores', () => {
    it('searches used or verified stores by name or city (public)', async () => {
      const user = await registerUser('u1@example.com', 'u1');
      const acme = (
        await createStore(user.accessToken, { name: 'Acme', city: 'Bogotá' })
      ).body as StoreBody;
      const beta = (
        await createStore(user.accessToken, { name: 'Beta', city: 'Medellín' })
      ).body as StoreBody;
      // Attach an offer so the stores are no longer orphans (otherwise hidden).
      await createOffer(user.accessToken, acme.id);
      await createOffer(user.accessToken, beta.id);

      const byName = await request(app.getHttpServer()).get('/stores?q=acme');
      expect(byName.status).toBe(200);
      expect((byName.body as StoreBody[]).map((s) => s.name)).toEqual(['Acme']);

      const byCity = await request(app.getHttpServer()).get('/stores?q=medell');
      expect((byCity.body as StoreBody[]).map((s) => s.name)).toEqual(['Beta']);
    });

    it('hides unverified orphan stores, then surfaces them once attached to an offer', async () => {
      const user = await registerUser('u1b@example.com', 'u1b');
      const store = (
        await createStore(user.accessToken, { name: 'Orphan', city: 'Cali' })
      ).body as StoreBody;

      const hidden = await request(app.getHttpServer()).get('/stores?q=orphan');
      expect((hidden.body as StoreBody[]).length).toBe(0);

      await createOffer(user.accessToken, store.id);
      const shown = await request(app.getHttpServer()).get('/stores?q=orphan');
      expect((shown.body as StoreBody[]).map((s) => s.id)).toEqual([store.id]);
    });

    it('reuses an existing store on a same name+city creation (find-or-create)', async () => {
      const user = await registerUser('u1c@example.com', 'u1c');
      const first = (
        await createStore(user.accessToken, { name: 'Dewey', city: 'Cali' })
      ).body as StoreBody;
      const second = (
        await createStore(user.accessToken, { name: 'dewey', city: 'CALI' })
      ).body as StoreBody;

      expect(second.id).toBe(first.id);
    });
  });

  describe('GET /stores/:id', () => {
    it('returns a store, then 404 store.not_found when missing', async () => {
      const user = await registerUser('u2@example.com', 'u2');
      const created = await createStore(user.accessToken, {
        name: 'Acme',
        city: 'Bogotá',
      });
      const id = (created.body as StoreBody).id;

      const ok = await request(app.getHttpServer()).get(`/stores/${id}`);
      expect(ok.status).toBe(200);
      expect((ok.body as StoreBody).verified).toBe(false);

      const missing = await request(app.getHttpServer()).get('/stores/ghost');
      expect(missing.status).toBe(404);
      expect((missing.body as ErrorBody).key).toBe('store.not_found');
    });
  });

  describe('POST /stores', () => {
    it('rejects anonymous creation with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/stores')
        .send({ name: 'Acme', city: 'Bogotá' });
      expect(res.status).toBe(401);
    });

    it('creates an unverified store with coordinates', async () => {
      const user = await registerUser('u3@example.com', 'u3');

      const res = await createStore(user.accessToken, {
        name: 'Acme',
        city: 'Bogotá',
        address: 'Carrera 7',
        latitude: 4.61,
        longitude: -74.08,
      });

      expect(res.status).toBe(201);
      const body = res.body as StoreBody;
      expect(body.verified).toBe(false);
      expect(body.latitude).toBe(4.61);
      expect(body.longitude).toBe(-74.08);
    });
  });

  describe('GET /stores/geocode', () => {
    it('rejects without authentication with 401', async () => {
      const res = await request(app.getHttpServer()).get(
        '/stores/geocode?q=carrera',
      );
      expect(res.status).toBe(401);
    });

    it('returns geocoded suggestions for an authenticated user', async () => {
      const user = await registerUser('u4@example.com', 'u4');

      const res = await request(app.getHttpServer())
        .get('/stores/geocode?q=carrera 7 bogota')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      expect(geocodeStub.search).toHaveBeenCalledWith('carrera 7 bogota');
      expect((res.body as { city: string }[])[0].city).toBe('Bogotá');
    });
  });

  describe('PATCH /admin/stores/:id/verify', () => {
    it('forbids non-admins (403)', async () => {
      const user = await registerUser('u5@example.com', 'u5');
      const store = await createStore(user.accessToken, {
        name: 'Acme',
        city: 'Bogotá',
      });

      const res = await request(app.getHttpServer())
        .patch(`/admin/stores/${(store.body as StoreBody).id}/verify`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it('verifies a store as admin', async () => {
      const user = await registerUser('u6@example.com', 'u6');
      const admin = await registerAdmin('a6@example.com', 'a6');
      const store = await createStore(user.accessToken, {
        name: 'Acme',
        city: 'Bogotá',
      });

      const res = await request(app.getHttpServer())
        .patch(`/admin/stores/${(store.body as StoreBody).id}/verify`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'verified by phone' });

      expect(res.status).toBe(200);
      expect((res.body as StoreBody).verified).toBe(true);
    });
  });

  describe('POST /admin/stores/merge', () => {
    it('reassigns offers, deletes the source, and rejects a self-merge', async () => {
      const user = await registerUser('u7@example.com', 'u7');
      const admin = await registerAdmin('a7@example.com', 'a7');
      const source = (
        await createStore(user.accessToken, {
          name: 'Acme dup',
          city: 'Bogotá',
        })
      ).body as StoreBody;
      const target = (
        await createStore(user.accessToken, { name: 'Acme', city: 'Bogotá' })
      ).body as StoreBody;
      const offerId = await createOffer(user.accessToken, source.id);

      const merged = await request(app.getHttpServer())
        .post('/admin/stores/merge')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ sourceId: source.id, targetId: target.id });
      expect(merged.status).toBe(201);
      expect((merged.body as StoreBody).id).toBe(target.id);

      const sourceGone = await request(app.getHttpServer()).get(
        `/stores/${source.id}`,
      );
      expect(sourceGone.status).toBe(404);

      const offer = await request(app.getHttpServer()).get(
        `/offers/${offerId}`,
      );
      expect((offer.body as { store: { id: string } }).store.id).toBe(
        target.id,
      );

      const selfMerge = await request(app.getHttpServer())
        .post('/admin/stores/merge')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ sourceId: target.id, targetId: target.id });
      expect(selfMerge.status).toBe(400);
      expect((selfMerge.body as ErrorBody).key).toBe('store.merge_invalid');
    });
  });

  describe('GET /offers?near', () => {
    it('keeps only offers whose geolocated store is within the radius', async () => {
      const user = await registerUser('u8@example.com', 'u8');
      const store = (
        await createStore(user.accessToken, {
          name: 'Acme',
          city: 'Bogotá',
          latitude: 4.61,
          longitude: -74.08,
        })
      ).body as StoreBody;
      const nearOfferId = await createOffer(user.accessToken, store.id);
      await createOffer(user.accessToken); // no store -> excluded

      const near = await request(app.getHttpServer()).get(
        '/offers?near=4.61,-74.08&radiusKm=5',
      );
      expect(near.status).toBe(200);
      const ids = (near.body as { items: { id: string }[] }).items.map(
        (o) => o.id,
      );
      expect(ids).toEqual([nearOfferId]);

      const far = await request(app.getHttpServer()).get(
        '/offers?near=10,-74&radiusKm=5',
      );
      expect((far.body as { items: unknown[] }).items).toHaveLength(0);
    });
  });
});
