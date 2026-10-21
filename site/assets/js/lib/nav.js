// Shared navigation state, so views can update the URL without importing main.js.

export const nav = {
  section: null,
  listQuery: "",
  listHash: "#/pokemon",
};

/** Views call this when their filters change, so the URL stays shareable without re-rendering. */
export function replaceListQuery(params) {
  const qs = params.toString();
  const hash = `#/${nav.section}${qs ? `?${qs}` : ""}`;
  nav.listQuery = qs;
  nav.listHash = hash;
  history.replaceState(null, "", hash);
}
