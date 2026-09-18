export const ADMIN_WORKSPACE_TRANSITION_EVENT = 'admin:workspace-transition';

export const requestAdminWorkspaceTransition = (to) => {
  if (typeof window === 'undefined' || !to) return;
  window.dispatchEvent(new CustomEvent(ADMIN_WORKSPACE_TRANSITION_EVENT, { detail: { to } }));
};
