import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  getCommitDetails,
  type CommitDetails,
} from "../lib/api";
import { requireQueryInput } from "../lib/queryInput";

interface LoadedCommitDetails {
  readonly rootPath: string;
  readonly commit: string;
  readonly details: CommitDetails;
}

export interface CommitDetailsQueryState {
  readonly commitDetails: CommitDetails | null;
  readonly query: UseQueryResult<LoadedCommitDetails, Error>;
}

export function useCommitDetails(
  projectPath: string | null,
  commitHash: string | null,
): CommitDetailsQueryState {
  const query = useQuery({
    queryKey: ["commit-details", projectPath, commitHash],
    queryFn: async () => {
      const rootPath = requireQueryInput(projectPath, "commit details path");
      const commit = requireQueryInput(commitHash, "commit details commit");
      return {
        rootPath,
        commit,
        details: await getCommitDetails({ path: rootPath, commit }),
      };
    },
    enabled: Boolean(projectPath && commitHash),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const commitDetails =
    query.data?.rootPath === projectPath && query.data.commit === commitHash
      ? query.data.details
      : null;

  return { commitDetails, query };
}
