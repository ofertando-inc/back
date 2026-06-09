-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CategoryToOffer" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CategoryToOffer_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "_CategoryToOffer_B_index" ON "_CategoryToOffer"("B");

-- AddForeignKey
ALTER TABLE "_CategoryToOffer" ADD CONSTRAINT "_CategoryToOffer_A_fkey" FOREIGN KEY ("A") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryToOffer" ADD CONSTRAINT "_CategoryToOffer_B_fkey" FOREIGN KEY ("B") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the initial category set. Slugs are the stable join key with the front
-- i18n labels and icons; names here are an English fallback the front overrides.
INSERT INTO "categories" ("id", "slug", "name", "order", "createdAt") VALUES
  (gen_random_uuid(), 'technology', 'Technology', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'home', 'Home', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'fashion', 'Fashion', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'groceries', 'Groceries', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'restaurants', 'Restaurants', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'travel', 'Travel', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'entertainment', 'Entertainment', 7, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'beauty', 'Beauty', 8, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sports', 'Sports', 9, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'kids', 'Kids', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'services', 'Services', 11, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'other', 'Other', 99, CURRENT_TIMESTAMP);

-- Backfill existing offers with the "other" category (categoryIds is required on create going forward).
INSERT INTO "_CategoryToOffer" ("A", "B")
SELECT (SELECT "id" FROM "categories" WHERE "slug" = 'other'), "id" FROM "offers";
