const isProduction = process.env.VERCEL_ENV === 'production';

function warnWhenMissing(variableName) {
  if (!isProduction) {
    console.warn(
      `${variableName} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variableName} is configured`
    );
  }
}

module.exports = (request, response) => {
  const projectToken = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;

  if (!projectToken) warnWhenMissing('POSTHOG_PROJECT_TOKEN');
  if (!host) warnWhenMissing('POSTHOG_HOST');

  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json({ projectToken, host });
};
