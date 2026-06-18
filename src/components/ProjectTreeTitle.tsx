export function ProjectTreeTitle({ path }: { path: string }) {
  const { parent, name } = splitProjectPath(path);

  return (
    <span className="project-tree-title" title={path}>
      {parent ? <span className="project-tree-parent">{parent}/</span> : null}
      <span className="project-tree-name">{name}</span>
    </span>
  );
}

function splitProjectPath(path: string): { parent: string; name: string } {
  const normalized = path.replace(/\/+$/, "") || path;
  const parts = normalized.split("/").filter(Boolean);
  const name = parts.at(-1) ?? normalized;
  const parentParts = parts.slice(0, -1);
  const parent =
    normalized.startsWith("/") && parentParts.length > 0
      ? `/${parentParts.join("/")}`
      : parentParts.join("/");

  return { parent, name };
}
