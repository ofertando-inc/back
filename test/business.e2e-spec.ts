import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType, ClaimStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { GeocodingService } from '../src/modules/catalog/geocoding/geocoding.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './test-db';

type RegisteredUser = { accessToken: string; user: { id: string } };
type AccountBody = {
  id: string;
  email: string;
  username: string;
  role: string;
  accountType: string;
  status: string;
};
type ClaimBody = {
  id: string;
  status: string;
  note: string | null;
  user: { id: string; email: string; username: string };
  merchant: { id: string; name: string };
};
type OfferBody = {
  id: string;
  official: boolean;
  viewCount: number;
  clickCount: number;
  merchant: { id: string };
};
type ErrorBody = { key: string };

const geocodeStub = {
  search: jest.fn().mockResolvedValue([]),
  reverse: jest.fn().mockResolvedValue(null),
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

describe('Business accounts flow (e2e)', () => {
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

  async function registerWithRole(
    email: string,
    username: string,
    role: UserRole,
  ): Promise<RegisteredUser> {
    const account = await registerUser(email, username);
    await prisma.user.update({
      where: { id: account.user.id },
      data: { role },
    });
    return account;
  }

  // A business account with an approved affiliation on a fresh merchant.
  async function setupBusiness(
    email: string,
    username: string,
    merchantName: string,
  ): Promise<RegisteredUser & { merchantId: string }> {
    const account = await registerUser(email, username);
    await prisma.user.update({
      where: { id: account.user.id },
      data: { accountType: AccountType.BUSINESS },
    });
    const merchant = await prisma.merchant.create({
      data: {
        name: merchantName,
        nameNormalized: merchantName.toLowerCase(),
        ownerId: account.user.id,
      },
    });
    await prisma.merchantClaim.create({
      data: {
        userId: account.user.id,
        merchantId: merchant.id,
        status: ClaimStatus.APPROVED,
        resolvedAt: new Date(),
      },
    });
    return { ...account, merchantId: merchant.id };
  }

  function offerPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: 'An offer',
      description: 'A very compelling description',
      offerType: 'discount',
      startDate: futureIso(1),
      endDate: futureIso(7),
      categoryIds: [categoryId],
      isOnline: true,
      externalUrl: 'https://acme.co/deal',
      ...overrides,
    };
  }

  describe('root account management', () => {
    it('lets a ROOT create and edit accounts, and blocks ADMIN/USER', async () => {
      const root = await registerWithRole(
        'root@ofertando.co',
        'root',
        UserRole.ROOT,
      );
      const admin = await registerWithRole(
        'adm@ofertando.co',
        'adm',
        UserRole.ADMIN,
      );

      // ADMIN is not enough: root-only routes answer auth.forbidden_root.
      const forbidden = await request(app.getHttpServer())
        .post('/admin/accounts')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          email: 'b@corp.co',
          username: 'corp',
          password: 'password123',
        });
      expect(forbidden.status).toBe(403);
      expect((forbidden.body as ErrorBody).key).toBe('auth.forbidden_root');

      // ROOT creates a business account.
      const created = await request(app.getHttpServer())
        .post('/admin/accounts')
        .set('Authorization', `Bearer ${root.accessToken}`)
        .send({
          email: 'b@corp.co',
          username: 'corp',
          password: 'password123',
          accountType: 'BUSINESS',
        });
      expect(created.status).toBe(201);
      const account = created.body as AccountBody;
      expect(account.accountType).toBe('BUSINESS');
      expect(account.role).toBe('USER');

      // The provisional credentials work.
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'b@corp.co', password: 'password123' });
      expect(login.status).toBe(200);

      // Duplicate email is rejected with the stable key.
      const dup = await request(app.getHttpServer())
        .post('/admin/accounts')
        .set('Authorization', `Bearer ${root.accessToken}`)
        .send({
          email: 'b@corp.co',
          username: 'corp2',
          password: 'password123',
        });
      expect(dup.status).toBe(400);
      expect((dup.body as ErrorBody).key).toBe('user.email_taken');

      // ROOT edits (here: disables) the account.
      const updated = await request(app.getHttpServer())
        .patch(`/admin/accounts/${account.id}`)
        .set('Authorization', `Bearer ${root.accessToken}`)
        .send({ status: 'DISABLED' });
      expect(updated.status).toBe(200);
      expect((updated.body as AccountBody).status).toBe('DISABLED');

      // Accounts list filters by accountType.
      const list = await request(app.getHttpServer())
        .get('/admin/accounts?accountType=BUSINESS')
        .set('Authorization', `Bearer ${root.accessToken}`);
      expect(list.status).toBe(200);
      const items = (list.body as { items: AccountBody[] }).items;
      expect(items.map((a) => a.id)).toEqual([account.id]);
    });
  });

  describe('claims', () => {
    it('onboards directly (create+approve), enforcing owner uniqueness', async () => {
      const root = await registerWithRole('root2@o.co', 'root2', UserRole.ROOT);
      const biz = await registerUser('biz@corp.co', 'bizcorp');
      await prisma.user.update({
        where: { id: biz.user.id },
        data: { accountType: AccountType.BUSINESS },
      });
      const merchant = await prisma.merchant.create({
        data: { name: 'Acme', nameNormalized: 'acme' },
      });

      const created = await request(app.getHttpServer())
        .post('/admin/claims')
        .set('Authorization', `Bearer ${root.accessToken}`)
        .send({ userId: biz.user.id, merchantId: merchant.id, note: 'ok' });
      expect(created.status).toBe(201);
      const claim = created.body as ClaimBody;
      expect(claim.status).toBe('APPROVED');
      expect(claim.merchant.id).toBe(merchant.id);

      const owned = await prisma.merchant.findUnique({
        where: { id: merchant.id },
      });
      expect(owned?.ownerId).toBe(biz.user.id);

      // The merchant already has an owner: a second claim is refused.
      const other = await registerUser('other@corp.co', 'othercorp');
      await prisma.user.update({
        where: { id: other.user.id },
        data: { accountType: AccountType.BUSINESS },
      });
      const conflict = await request(app.getHttpServer())
        .post('/admin/claims')
        .set('Authorization', `Bearer ${root.accessToken}`)
        .send({ userId: other.user.id, merchantId: merchant.id });
      expect(conflict.status).toBe(409);
      expect((conflict.body as ErrorBody).key).toBe('merchant.already_owned');

      // An INDIVIDUAL applicant is refused.
      const individual = await registerUser('ind@x.co', 'ind');
      const merchant2 = await prisma.merchant.create({
        data: { name: 'Bodega', nameNormalized: 'bodega' },
      });
      const notBusiness = await request(app.getHttpServer())
        .post('/admin/claims')
        .set('Authorization', `Bearer ${root.accessToken}`)
        .send({ userId: individual.user.id, merchantId: merchant2.id });
      expect(notBusiness.status).toBe(400);
      expect((notBusiness.body as ErrorBody).key).toBe('account.not_business');
    });

    it('lists the PENDING queue and applies approve/reject transitions', async () => {
      const root = await registerWithRole('root3@o.co', 'root3', UserRole.ROOT);
      const biz = await registerUser('biz3@corp.co', 'biz3');
      await prisma.user.update({
        where: { id: biz.user.id },
        data: { accountType: AccountType.BUSINESS },
      });
      const merchant = await prisma.merchant.create({
        data: { name: 'Acme', nameNormalized: 'acme' },
      });
      const pending = await prisma.merchantClaim.create({
        data: { userId: biz.user.id, merchantId: merchant.id },
      });

      const queue = await request(app.getHttpServer())
        .get('/admin/claims?status=PENDING')
        .set('Authorization', `Bearer ${root.accessToken}`);
      expect(queue.status).toBe(200);
      expect(
        (queue.body as { items: ClaimBody[] }).items.map((c) => c.id),
      ).toEqual([pending.id]);

      const approved = await request(app.getHttpServer())
        .patch(`/admin/claims/${pending.id}/approve`)
        .set('Authorization', `Bearer ${root.accessToken}`)
        .send({ reason: 'papers verified' });
      expect(approved.status).toBe(200);
      expect((approved.body as ClaimBody).status).toBe('APPROVED');

      // Already resolved: approving or rejecting again conflicts.
      const again = await request(app.getHttpServer())
        .patch(`/admin/claims/${pending.id}/reject`)
        .set('Authorization', `Bearer ${root.accessToken}`)
        .send({ note: 'nope' });
      expect(again.status).toBe(409);
      expect((again.body as ErrorBody).key).toBe('claim.already_resolved');
    });
  });

  describe('business space', () => {
    it('blocks non-affiliated accounts and serves /business/me to affiliated ones', async () => {
      // INDIVIDUAL account.
      const individual = await registerUser('ind2@x.co', 'ind2');
      const notBusiness = await request(app.getHttpServer())
        .get('/business/me')
        .set('Authorization', `Bearer ${individual.accessToken}`);
      expect(notBusiness.status).toBe(403);
      expect((notBusiness.body as ErrorBody).key).toBe('account.not_business');

      // BUSINESS account without an approved claim.
      const orphan = await registerUser('orph@corp.co', 'orphcorp');
      await prisma.user.update({
        where: { id: orphan.user.id },
        data: { accountType: AccountType.BUSINESS },
      });
      const noAffiliation = await request(app.getHttpServer())
        .get('/business/me')
        .set('Authorization', `Bearer ${orphan.accessToken}`);
      expect(noAffiliation.status).toBe(403);
      expect((noAffiliation.body as ErrorBody).key).toBe(
        'account.no_affiliation',
      );

      // Affiliated business.
      const biz = await setupBusiness('me@corp.co', 'mecorp', 'Acme');
      const me = await request(app.getHttpServer())
        .get('/business/me')
        .set('Authorization', `Bearer ${biz.accessToken}`);
      expect(me.status).toBe(200);
      const body = me.body as {
        user: { id: string };
        merchant: { id: string };
        claim: { status: string };
      };
      expect(body.user.id).toBe(biz.user.id);
      expect(body.merchant.id).toBe(biz.merchantId);
      expect(body.claim.status).toBe('APPROVED');
    });

    it('publishes an official offer for its own brand, forcing the merchant', async () => {
      const biz = await setupBusiness('pub@corp.co', 'pubcorp', 'Acme');
      const spoofed = await prisma.merchant.create({
        data: { name: 'Other', nameNormalized: 'other' },
      });

      // merchantId is not part of the business DTO: sending one is rejected
      // by the strict validation layer (no way to publish for another brand).
      const rejected = await request(app.getHttpServer())
        .post('/business/offers')
        .set('Authorization', `Bearer ${biz.accessToken}`)
        .send(offerPayload({ merchantId: spoofed.id }));
      expect(rejected.status).toBe(400);
      expect((rejected.body as ErrorBody).key).toBe('validation.failed');

      const res = await request(app.getHttpServer())
        .post('/business/offers')
        .set('Authorization', `Bearer ${biz.accessToken}`)
        .send(offerPayload());
      expect(res.status).toBe(201);
      const offer = res.body as OfferBody;
      expect(offer.official).toBe(true);
      expect(offer.merchant.id).toBe(biz.merchantId);
    });

    it('keeps the community path unofficial for a business on another merchant', async () => {
      const biz = await setupBusiness('com@corp.co', 'comcorp', 'Acme');

      const res = await request(app.getHttpServer())
        .post('/offers')
        .set('Authorization', `Bearer ${biz.accessToken}`)
        .send(offerPayload({ merchantName: 'Someone Else' }));
      expect(res.status).toBe(201);
      expect((res.body as OfferBody).official).toBe(false);
    });

    it('requests a new address (unverified) that lands in the admin queue', async () => {
      const biz = await setupBusiness('loc@corp.co', 'loccorp', 'Acme');
      const admin = await registerWithRole('a@o.co', 'adm2', UserRole.ADMIN);

      const created = await request(app.getHttpServer())
        .post('/business/locations')
        .set('Authorization', `Bearer ${biz.accessToken}`)
        .send({ address: 'Carrera 7 #1-2', city: 'Bogotá' });
      expect(created.status).toBe(201);
      const location = created.body as { id: string; verified: boolean };
      expect(location.verified).toBe(false);

      const queue = await request(app.getHttpServer())
        .get(`/admin/locations?verified=false&merchant=${biz.merchantId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(
        (queue.body as { items: { id: string }[] }).items.map((l) => l.id),
      ).toContain(location.id);
    });

    it('aggregates brand stats (offers, views, clicks)', async () => {
      const biz = await setupBusiness('st@corp.co', 'stcorp', 'Acme');
      const offerRes = await request(app.getHttpServer())
        .post('/business/offers')
        .set('Authorization', `Bearer ${biz.accessToken}`)
        .send(offerPayload());
      const offer = offerRes.body as OfferBody;

      await request(app.getHttpServer()).post(`/offers/${offer.id}/view`);
      await request(app.getHttpServer()).post(`/offers/${offer.id}/view`);
      await request(app.getHttpServer()).post(`/offers/${offer.id}/click`);

      const stats = await request(app.getHttpServer())
        .get('/business/stats')
        .set('Authorization', `Bearer ${biz.accessToken}`);
      expect(stats.status).toBe(200);
      expect(stats.body).toMatchObject({
        offers: { total: 1, active: 1 },
        views: 2,
        clicks: 1,
      });
    });
  });

  describe('tracking', () => {
    it('counts anonymous views/clicks but never the author', async () => {
      const author = await registerUser('tr@x.co', 'tr');
      const res = await request(app.getHttpServer())
        .post('/offers')
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send(offerPayload({ merchantName: 'Acme' }));
      const offer = res.body as OfferBody;

      // Anonymous hits count.
      const anonView = await request(app.getHttpServer()).post(
        `/offers/${offer.id}/view`,
      );
      expect(anonView.status).toBe(204);
      await request(app.getHttpServer()).post(`/offers/${offer.id}/click`);

      // The author's own hits do not.
      await request(app.getHttpServer())
        .post(`/offers/${offer.id}/view`)
        .set('Authorization', `Bearer ${author.accessToken}`);

      const detail = await request(app.getHttpServer()).get(
        `/offers/${offer.id}`,
      );
      const body = detail.body as OfferBody;
      expect(body.viewCount).toBe(1);
      expect(body.clickCount).toBe(1);
    });
  });
});
