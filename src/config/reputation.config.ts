// Reputation scoring (points per event). All configurable via env.
export const reputationConfig = () => ({
  reputation: {
    offerUpvote: Number(process.env.REPUTATION_OFFER_UPVOTE ?? 2),
    commentUpvote: Number(process.env.REPUTATION_COMMENT_UPVOTE ?? 1),
    reportResolved: Number(process.env.REPUTATION_REPORT_RESOLVED ?? 3),
    reportDismissed: Number(process.env.REPUTATION_REPORT_DISMISSED ?? -1),
    offerDisabled: Number(process.env.REPUTATION_OFFER_DISABLED ?? -5),
  },
});
