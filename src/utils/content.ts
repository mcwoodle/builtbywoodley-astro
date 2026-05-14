import { getCollection, render as renderEntry } from "astro:content";

export async function getProjectPaths(collectionName: "projects" | "mockedProjects") {
  const projects = await getCollection(collectionName);
  return projects.map((project) => ({
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
