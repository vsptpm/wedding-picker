/** Shown on the login screen, home hero and app bar, e.g. "Anshad & Subhana". */
export const siteTitle = () => process.env.SITE_TITLE?.trim() || "Our Wedding";
/** Optional small line above the title, e.g. "12 October 2026 · Kochi". */
export const siteSubtitle = () => process.env.SITE_SUBTITLE?.trim() || "";
