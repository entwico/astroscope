export type Project = {
  id: string;
  name: string;
  owner: string;
};

// in-memory projects — reset on server restart
const PROJECTS: Record<string, Project> = {
  p1: { id: 'p1', name: 'Alpha', owner: 'alice' },
  p2: { id: 'p2', name: 'Beta', owner: 'root' },
};

export function findProject(id: string): Project | undefined {
  return PROJECTS[id];
}

export function renameProject(id: string, name: string): Project {
  const project = PROJECTS[id];

  if (!project) {
    throw new Error(`no project ${id}`);
  }

  project.name = name;

  return project;
}
