import { OmitType } from '@nestjs/mapped-types';

import { CreateOfferDto } from '../../../catalog/offers/dto/create-offer.dto';

// A business publishes for its own brand: the merchant is forced server-side
// to the affiliated one, and the strict validation layer rejects any merchant
// field sent by the client.
export class CreateBusinessOfferDto extends OmitType(CreateOfferDto, [
  'merchantId',
  'merchantName',
] as const) {}
