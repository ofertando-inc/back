export const reportConfig = () => ({
  reports: {
    threshold: Number(process.env.REPORT_THRESHOLD ?? 10),
  },
});
