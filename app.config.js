/**
 * Extends app.json. The only thing decided here is where the web build is
 * served from: GitHub Pages serves a repository at /<repository-name>, so that
 * build sets WEB_BASE_URL. Everything else runs at the root.
 */
module.exports = ({ config }) => {
  const baseUrl = process.env.WEB_BASE_URL;
  return baseUrl ? { ...config, experiments: { ...config.experiments, baseUrl } } : config;
};
