import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';

import {
  COMMENTS_CREATED_TOTAL,
  OFFERS_CREATED_TOTAL,
  REPORTS_CREATED_TOTAL,
} from './metrics.constants';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  const offersCreated = { inc: jest.fn() };
  const reportsCreated = { inc: jest.fn() };
  const commentsCreated = { inc: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: getToken(OFFERS_CREATED_TOTAL), useValue: offersCreated },
        { provide: getToken(REPORTS_CREATED_TOTAL), useValue: reportsCreated },
        {
          provide: getToken(COMMENTS_CREATED_TOTAL),
          useValue: commentsCreated,
        },
      ],
    }).compile();

    service = module.get(MetricsService);
  });

  it('counts created offers with the official label', () => {
    service.offerCreated(true);
    service.offerCreated(false);

    expect(offersCreated.inc).toHaveBeenNthCalledWith(1, { official: 'true' });
    expect(offersCreated.inc).toHaveBeenNthCalledWith(2, { official: 'false' });
  });

  it('counts created reports with the target label', () => {
    service.reportCreated('offer');
    service.reportCreated('comment');

    expect(reportsCreated.inc).toHaveBeenNthCalledWith(1, { target: 'offer' });
    expect(reportsCreated.inc).toHaveBeenNthCalledWith(2, {
      target: 'comment',
    });
  });

  it('counts created comments', () => {
    service.commentCreated();

    expect(commentsCreated.inc).toHaveBeenCalledTimes(1);
  });
});
