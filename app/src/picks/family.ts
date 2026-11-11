// JC-34 (v0.0.15): the shared (family) picks leaderboard is unlocked on the SERVER. The app sends the password once
// to the AI Worker's /lb/unlock (rate-limited and locked out there) and keeps only the `lb_` token it gets back.
// The app no longer derives, stores or probes any collection name, so a phone (or a script) can't test passwords
// against the site. The password is never stored.
export const validToken = (t: any): t is string => typeof t === 'string' && /^lb_[A-Za-z0-9_-]{40,200}$/.test(t);
