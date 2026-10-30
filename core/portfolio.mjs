import { hash } from './security.mjs';

// This deployment can be shared as a read-only portfolio while the trusted
// gateway identity retains the owner's private workspace. Fail closed if unpinned.
export async function workspaceAccess(user, env = {}) {
  if (env.PUBLIC_PORTFOLIO_ONLY !== 'true') return true;
  return Boolean(user?.userId && user?.email && env.SITE_OWNER_EMAIL_SHA256 &&
    await hash(user.email.trim().toLowerCase()) === env.SITE_OWNER_EMAIL_SHA256);
}
