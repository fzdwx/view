export interface CommitDetailsSignatureLike {
  readonly status: string;
  readonly summary: string;
}

export interface CommitDetailsLike {
  readonly hash: string;
  readonly compareBase?: string | null;
}

export function shortCommitHash(hash: string): string {
  return hash.slice(0, 7);
}

export function commitParentLabels(parents: readonly string[]): string[] {
  return parents.map(shortCommitHash);
}

export function commitRefLabel(refName: string): string {
  return refName
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "")
    .replace(/^refs\/tags\//, "");
}

export function commitSignatureLabel(
  signature: CommitDetailsSignatureLike,
): string {
  switch (signature.status) {
    case "valid":
      return "Verified signature";
    case "unsigned":
      return "Unsigned commit";
    default:
      return "Signature unknown";
  }
}

export function commitDetailsCopyText(details: CommitDetailsLike): string {
  return details.hash;
}

export function commitCompareLabel(details: CommitDetailsLike): string {
  if (!details.compareBase) {
    return "Compare unavailable";
  }
  return `Compare ${shortCommitHash(details.compareBase)}..${shortCommitHash(details.hash)}`;
}
