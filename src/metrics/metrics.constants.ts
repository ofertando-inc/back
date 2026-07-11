export const METRICS_PATH = '/metrics';

// HTTP metrics keep the conventional Prometheus names; only business metrics
// carry the application prefix.
export const HTTP_REQUESTS_TOTAL = 'http_requests_total';
export const HTTP_REQUEST_DURATION_SECONDS = 'http_request_duration_seconds';

export const OFFERS_CREATED_TOTAL = 'ofertando_offers_created_total';
export const REPORTS_CREATED_TOTAL = 'ofertando_reports_created_total';
export const COMMENTS_CREATED_TOTAL = 'ofertando_comments_created_total';

export const HTTP_DURATION_BUCKETS = [
  0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
];
