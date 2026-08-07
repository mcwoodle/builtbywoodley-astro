import { getCollection, render as renderEntry } from "astro:content";

export async function getProjectPaths(collectionName: "projects" | "mockedProjects" | "software") {
  const projects = await getCollection(collectionName);
  // Skip entries that use cardUrl (they link elsewhere and have no detail page)
  return projects
    .filter((project) => !("cardUrl" in project.data && project.data.cardUrl))
    .map((project) => ({
      params: { slug: project.id },
      props: { project },
    }));
}

export async function renderProjectContent(project: any) {
  if (typeof project?.deferredRender === "function") {
    const rendered = await project.deferredRender();
    return rendered.Content;
  }
  if (typeof project?.render === "function") {
    const rendered = await project.render();
    return rendered.Content;
  }
  const renderedFromHelper = await renderEntry(project);
  return renderedFromHelper.Content;
}
