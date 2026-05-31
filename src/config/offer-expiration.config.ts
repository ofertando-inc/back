export const offerExpirationConfig = () => ({
  offerExpiration: {
    enabled: process.env.OFFER_EXPIRATION_ENABLED === 'true',
    interval: process.env.OFFER_EXPIRATION_INTERVAL ?? '1h',
  },
});
