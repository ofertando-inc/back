import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { GeocodingService } from '../src/geocoding/geocoding.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './test-db';

type RegisteredUser = { accessToken: string; user: { id: string } };
type MerchantBody = {
  id: string;
  name: string;
  verified: boolean;
  blockedAt: string | null;
};
type LocationBody = { id: string; city: string; verified: boolean };
type OfferBody = {
  id: string;
  merchant: { id: string; name: string; verified: boolean; blocked: boolean };
  location: { id: string; city: string } | null;
};
type ErrorBody = { key: string };

const suggestion = {
  displayName: 'Carrera 7, Bogotá, Colombia',
  latitude: 4.61,
  longitude: -74.08,
  city: 'Bogotá',
  region: 'Bogotá',
  address: 'Carrera 7',
};
const geocodeStub = {
  search: jest.fn().mockResolvedValue([suggestion]),
  reverse: jest.fn().mockResolvedValue(suggestion),
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

describe('Merchants flow (e2e)', () => {
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

  async function createOffer(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<OfferBody> {
    const res = await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'An offer',
        description: 'A very compelling description',
        offerType: 'discount',
        startDate: futureIso(1),
        endDate: futureIso(7),
        categoryIds: [categoryId],
        merchantName: 'Acme',
        location: { address: 'Carrera 7', city: 'Bogotá' },
        ...overrides,
      });
    return res.body as OfferBody;
  }

  describe('GET /merchants', () => {
    it('suggests used or verified merchants, hiding unverified orphans', async () => {
      const user = await registerUser('m1@example.com', 'm1');
      // Used merchant (attached to an offer) -> visible.
      await createOffer(user.accessToken, { merchantName: 'Acme' });
      // Orphan merchant (created, never used, unverified) -> hidden.
      await request(app.getHttpServer())
        .post('/merchants')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Orphan' });

      const used = await request(app.getHttpServer()).get('/merchants?q=acme');
      expect(used.status).toBe(200);
      expect((used.body as MerchantBody[]).map((m) => m.name)).toEqual([
        'Acme',
      ]);

      const orphan = await request(app.getHttpServer()).get(
        '/merchants?q=orphan',
      );
      expect((orphan.body as MerchantBody[]).length).toBe(0);
    });
  });

  describe('GET /merchants/:id', () => {
    it('returns a merchant, then 404 merchant.not_found when missing', async () => {
      const user = await registerUser('m2@example.com', 'm2');
      const offer = await createOffer(user.accessToken);

      const ok = await request(app.getHttpServer()).get(
        `/merchants/${offer.merchant.id}`,
      );
      expect(ok.status).toBe(200);

      const missing = await request(app.getHttpServer()).get(
        '/merchants/ghost',
      );
      expect(missing.status).toBe(404);
      expect((missing.body as ErrorBody).key).toBe('merchant.not_found');
    });
  });

  describe('POST /merchants', () => {
    it('rejects anonymous creation, and is find-or-create on the name', async () => {
      const anon = await request(app.getHttpServer())
        .post('/merchants')
        .send({ name: 'Acme' });
      expect(anon.status).toBe(401);

      const user = await registerUser('m3@example.com', 'm3');
      const first = await request(app.getHttpServer())
        .post('/merchants')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Éxito' });
      const second = await request(app.getHttpServer())
        .post('/merchants')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'exito' });

      expect((second.body as MerchantBody).id).toBe(
        (first.body as MerchantBody).id,
      );
    });
  });

  describe('GET /geocode', () => {
    it('rejects without auth, returns suggestions with auth', async () => {
      const anon = await request(app.getHttpServer()).get('/geocode?q=carrera');
      expect(anon.status).toBe(401);

      const user = await registerUser('m4@example.com', 'm4');
      const res = await request(app.getHttpServer())
        .get('/geocode?q=carrera 7 bogota')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      expect(geocodeStub.search).toHaveBeenCalledWith('carrera 7 bogota');
      expect((res.body as { city: string }[])[0].city).toBe('Bogotá');
    });

    it('reverse-geocodes coordinates to a single suggestion (JWT)', async () => {
      const anon = await request(app.getHttpServer()).get(
        '/geocode/reverse?lat=4.61&lng=-74.08',
      );
      expect(anon.status).toBe(401);

      const user = await registerUser('m4b@example.com', 'm4b');
      const res = await request(app.getHttpServer())
        .get('/geocode/reverse?lat=4.61&lng=-74.08')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      expect(geocodeStub.reverse).toHaveBeenCalledWith(4.61, -74.08);
      expect((res.body as { city: string }).city).toBe('Bogotá');
    });
  });

  describe('admin verification', () => {
    it('verifies a merchant (admin only)', async () => {
      const user = await registerUser('m5@example.com', 'm5');
      const admin = await registerAdmin('a5@example.com', 'a5');
      const offer = await createOffer(user.accessToken);

      const forbidden = await request(app.getHttpServer())
        .patch(`/admin/merchants/${offer.merchant.id}/verify`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({});
      expect(forbidden.status).toBe(403);

      const res = await request(app.getHttpServer())
        .patch(`/admin/merchants/${offer.merchant.id}/verify`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'known brand' });
      expect(res.status).toBe(200);
      expect((res.body as MerchantBody).verified).toBe(true);
    });

    it('verifies a location (admin)', async () => {
      const user = await registerUser('m6@example.com', 'm6');
      const admin = await registerAdmin('a6@example.com', 'a6');
      const offer = await createOffer(user.accessToken);

      const res = await request(app.getHttpServer())
        .patch(`/admin/locations/${offer.location!.id}/verify`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({});
      expect(res.status).toBe(200);
      expect((res.body as LocationBody).verified).toBe(true);
    });
  });

  describe('POST /admin/merchants/merge', () => {
    it('moves offers to the target, deletes the source, and rejects a self-merge', async () => {
      const user = await registerUser('m7@example.com', 'm7');
      const admin = await registerAdmin('a7@example.com', 'a7');
      const dupOffer = await createOffer(user.accessToken, {
        merchantName: 'Acme Duplicate',
      });
      const canonicalOffer = await createOffer(user.accessToken, {
        merchantName: 'Acme',
      });

      const merged = await request(app.getHttpServer())
        .post('/admin/merchants/merge')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          sourceId: dupOffer.merchant.id,
          targetId: canonicalOffer.merchant.id,
        });
      expect(merged.status).toBe(201);
      expect((merged.body as MerchantBody).id).toBe(canonicalOffer.merchant.id);

      const sourceGone = await request(app.getHttpServer()).get(
        `/merchants/${dupOffer.merchant.id}`,
      );
      expect(sourceGone.status).toBe(404);

      const reassigned = await request(app.getHttpServer()).get(
        `/offers/${dupOffer.id}`,
      );
      expect((reassigned.body as OfferBody).merchant.id).toBe(
        canonicalOffer.merchant.id,
      );

      const selfMerge = await request(app.getHttpServer())
        .post('/admin/merchants/merge')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          sourceId: canonicalOffer.merchant.id,
          targetId: canonicalOffer.merchant.id,
        });
      expect(selfMerge.status).toBe(400);
      expect((selfMerge.body as ErrorBody).key).toBe('merchant.merge_invalid');
    });
  });

  describe('GET /offers?near', () => {
    it('keeps only offers whose location is within the radius', async () => {
      const user = await registerUser('m8@example.com', 'm8');
      const near = await createOffer(user.accessToken, {
        location: {
          address: 'Carrera 7',
          city: 'Bogotá',
          latitude: 4.61,
          longitude: -74.08,
        },
      });
      await createOffer(user.accessToken, {
        isOnline: true,
        externalUrl: 'https://x.co',
      });

      const res = await request(app.getHttpServer()).get(
        '/offers?near=4.61,-74.08&radiusKm=5',
      );
      expect(res.status).toBe(200);
      const ids = (res.body as { items: { id: string }[] }).items.map(
        (o) => o.id,
      );
      expect(ids).toEqual([near.id]);

      const far = await request(app.getHttpServer()).get(
        '/offers?near=10,-74&radiusKm=5',
      );
      expect((far.body as { items: unknown[] }).items).toHaveLength(0);
    });
  });

  describe('admin moderation queues', () => {
    type Paginated<T> = { items: T[]; nextCursor: string | null };

    it('lists unverified merchants and locations (admin only)', async () => {
      const user = await registerUser('m9@example.com', 'm9');
      const admin = await registerAdmin('a9@example.com', 'a9');
      const offer = await createOffer(user.accessToken);

      const forbidden = await request(app.getHttpServer())
        .get('/admin/merchants?verified=false')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(forbidden.status).toBe(403);

      const merchants = await request(app.getHttpServer())
        .get('/admin/merchants?verified=false')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(merchants.status).toBe(200);
      const mBody = merchants.body as Paginated<MerchantBody>;
      expect(mBody.items.map((m) => m.id)).toContain(offer.merchant.id);
      expect(mBody.items.every((m) => m.verified === false)).toBe(true);

      const locations = await request(app.getHttpServer())
        .get(`/admin/locations?verified=false&merchant=${offer.merchant.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(locations.status).toBe(200);
      const lBody = locations.body as Paginated<
        LocationBody & { merchant: { id: string; name: string } }
      >;
      expect(lBody.items).toHaveLength(1);
      expect(lBody.items[0].id).toBe(offer.location!.id);
      expect(lBody.items[0].merchant.id).toBe(offer.merchant.id);
    });

    it('filters blocked merchants when blocked=true', async () => {
      const user = await registerUser('m9b@example.com', 'm9b');
      const admin = await registerAdmin('a9b@example.com', 'a9b');
      const offer = await createOffer(user.accessToken);

      await request(app.getHttpServer())
        .post(`/admin/merchants/${offer.merchant.id}/block`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'fraud' });

      const blocked = await request(app.getHttpServer())
        .get('/admin/merchants?blocked=true')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = blocked.body as Paginated<MerchantBody>;
      expect(body.items.map((m) => m.id)).toEqual([offer.merchant.id]);
      expect(body.items[0].blockedAt).not.toBeNull();
    });
  });

  describe('admin block / unblock', () => {
    it('hides a blocked merchant offers from the public, owner sees blocked:true', async () => {
      const user = await registerUser('b1@example.com', 'b1');
      const admin = await registerAdmin('ab1@example.com', 'ab1');
      const offer = await createOffer(user.accessToken);

      const forbidden = await request(app.getHttpServer())
        .post(`/admin/merchants/${offer.merchant.id}/block`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({});
      expect(forbidden.status).toBe(403);

      const blocked = await request(app.getHttpServer())
        .post(`/admin/merchants/${offer.merchant.id}/block`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'fraud' });
      expect(blocked.status).toBe(201);
      expect((blocked.body as MerchantBody).blockedAt).not.toBeNull();

      // Public listing no longer surfaces the offer.
      const publicList = await request(app.getHttpServer()).get('/offers');
      const listIds = (
        publicList.body as { items: { id: string }[] }
      ).items.map((o) => o.id);
      expect(listIds).not.toContain(offer.id);

      // Public detail is gone (404).
      const publicDetail = await request(app.getHttpServer()).get(
        `/offers/${offer.id}`,
      );
      expect(publicDetail.status).toBe(404);

      // The owner still sees it, flagged as blocked.
      const mine = await request(app.getHttpServer())
        .get('/offers/mine')
        .set('Authorization', `Bearer ${user.accessToken}`);
      const mineItems = (mine.body as { items: OfferBody[] }).items;
      const ownOffer = mineItems.find((o) => o.id === offer.id);
      expect(ownOffer?.merchant.blocked).toBe(true);

      // Unblocking brings it back to the public.
      const unblocked = await request(app.getHttpServer())
        .post(`/admin/merchants/${offer.merchant.id}/unblock`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({});
      expect((unblocked.body as MerchantBody).blockedAt).toBeNull();

      const reDetail = await request(app.getHttpServer()).get(
        `/offers/${offer.id}`,
      );
      expect(reDetail.status).toBe(200);
      expect((reDetail.body as OfferBody).merchant.blocked).toBe(false);
    });
  });

  describe('admin edit merchant / location', () => {
    it('renames a merchant and rejects a name already taken', async () => {
      const user = await registerUser('e1@example.com', 'e1');
      const admin = await registerAdmin('ae1@example.com', 'ae1');
      const offer = await createOffer(user.accessToken, {
        merchantName: 'Acme',
      });
      const other = await createOffer(user.accessToken, {
        merchantName: 'Bodega',
        location: { address: 'Calle 100', city: 'Medellín' },
      });

      const renamed = await request(app.getHttpServer())
        .patch(`/admin/merchants/${offer.merchant.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Acme Stores' });
      expect(renamed.status).toBe(200);
      expect((renamed.body as MerchantBody).name).toBe('Acme Stores');

      const clash = await request(app.getHttpServer())
        .patch(`/admin/merchants/${offer.merchant.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Bodega' });
      expect(clash.status).toBe(400);
      expect((clash.body as ErrorBody).key).toBe('merchant.name_taken');
      expect(other.merchant.id).toBeDefined();
    });

    it('edits a location and syncs the offer city', async () => {
      const user = await registerUser('e2@example.com', 'e2');
      const admin = await registerAdmin('ae2@example.com', 'ae2');
      const offer = await createOffer(user.accessToken);

      const edited = await request(app.getHttpServer())
        .patch(`/admin/locations/${offer.location!.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ city: 'Medellín' });
      expect(edited.status).toBe(200);
      expect((edited.body as LocationBody).city).toBe('Medellín');

      const detail = await request(app.getHttpServer()).get(
        `/offers/${offer.id}`,
      );
      expect((detail.body as OfferBody).location!.city).toBe('Medellín');
    });
  });

  describe('admin delete location', () => {
    it('refuses an in-use location, then reassigns to a same-merchant target', async () => {
      const user = await registerUser('d1@example.com', 'd1');
      const admin = await registerAdmin('ad1@example.com', 'ad1');
      const offerA = await createOffer(user.accessToken, {
        merchantName: 'Acme',
        location: { address: 'Carrera 7', city: 'Bogotá' },
      });
      const offerB = await createOffer(user.accessToken, {
        merchantName: 'Acme',
        location: { address: 'Calle 100', city: 'Medellín' },
      });
      expect(offerA.merchant.id).toBe(offerB.merchant.id);

      const refused = await request(app.getHttpServer())
        .delete(`/admin/locations/${offerA.location!.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(refused.status).toBe(409);
      expect((refused.body as ErrorBody).key).toBe('location.in_use');

      const reassigned = await request(app.getHttpServer())
        .delete(
          `/admin/locations/${offerA.location!.id}?reassignTo=${offerB.location!.id}`,
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(reassigned.status).toBe(200);

      const detail = await request(app.getHttpServer()).get(
        `/offers/${offerA.id}`,
      );
      expect((detail.body as OfferBody).location!.id).toBe(offerB.location!.id);
      expect((detail.body as OfferBody).location!.city).toBe('Medellín');
    });
  });
});
