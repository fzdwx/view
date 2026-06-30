export interface SavedProject {
  id: string;
  name: string;
  rootPath: string;
  activePath: string;
}

const storageKey = "view.projects.v1";

export function loadSavedProjects(): SavedProject[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as SavedProject[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: SavedProject[]): void {
  localStorage.setItem(storageKey, JSON.stringify(projects));
}

export function projectNameFromPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized.split(/[\\/]/).pop() || normalized || "Repository";
}

export function upsertProject(
  projects: SavedProject[],
  rootPath: string,
  activePath = rootPath,
): SavedProject[] {
  const existing = projects.find((project) => project.rootPath === rootPath);
  if (existing) {
    return projects.map((project) =>
      project.rootPath === rootPath
        ? { ...project, activePath, name: projectNameFromPath(rootPath) }
        : project,
    );
  }

  return [
    ...projects,
    {
      id: crypto.randomUUID(),
      name: projectNameFromPath(rootPath),
      rootPath,
      activePath,
    },
  ];
}

export function activateProjectPath(
  projects: SavedProject[],
  rootPath: string,
  activePath: string,
): {
  readonly projects: SavedProject[];
  readonly projectId: string | null;
} {
  const nextProjects = upsertProject(projects, rootPath, activePath);
  return {
    projects: nextProjects,
    projectId:
      nextProjects.find((project) => project.rootPath === rootPath)?.id ??
      nextProjects.at(-1)?.id ??
      null,
  };
}
