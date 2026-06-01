export const commentReportConfig = () => ({
  commentReports: {
    threshold: Number(process.env.COMMENT_REPORT_THRESHOLD ?? 5),
  },
});
