export const pageHead = (title: string, description: string) => () => ({
  meta: [
    { title: `${title} — مساحة العمل الذكية` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — Personal AI Workspace` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ],
});
