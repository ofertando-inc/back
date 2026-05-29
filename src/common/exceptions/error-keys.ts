export const ErrorKey = {
  AuthUnauthorized: 'auth.unauthorized',
  AuthForbidden: 'auth.forbidden',
  AuthInvalidCredentials: 'auth.invalid_credentials',
  AuthAccountDisabled: 'auth.account_disabled',

  UserEmailTaken: 'user.email_taken',
  UserUsernameTaken: 'user.username_taken',
  UserNotFound: 'user.not_found',
  UserInvalidStatusTransition: 'user.invalid_status_transition',

  OfferNotFound: 'offer.not_found',
  OfferForbidden: 'offer.forbidden',
  OfferInvalidDates: 'offer.invalid_dates',
  OfferInvalidStatusTransition: 'offer.invalid_status_transition',

  VoteOfferNotVoteable: 'vote.offer_not_voteable',

  ReportOfferNotReportable: 'report.offer_not_reportable',

  PaginationInvalidCursor: 'pagination.invalid_cursor',

  ValidationFailed: 'validation.failed',

  DbUniqueViolation: 'db.unique_violation',
  DbNotFound: 'db.not_found',

  ErrorBadRequest: 'error.bad_request',
  ErrorNotFound: 'error.not_found',
  ErrorTooManyRequests: 'error.too_many_requests',
  ErrorInternal: 'error.internal',
} as const;

export type ErrorKey = (typeof ErrorKey)[keyof typeof ErrorKey];
