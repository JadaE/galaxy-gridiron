// Wraps app.json. Only the iPhone web export sets PWA_BASE (its secret folder on here.now); Android builds are unchanged.
module.exports = ({ config }) => (process.env.PWA_BASE ? { ...config, experiments: { ...(config.experiments || {}), baseUrl: process.env.PWA_BASE } } : config);
