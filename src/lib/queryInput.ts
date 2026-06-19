class QueryInputError extends Error {
  readonly inputName: string;

  constructor(inputName: string) {
    super(`${inputName} is required before running this query.`);
    this.name = "QueryInputError";
    this.inputName = inputName;
  }
}

export function requireQueryInput<T>(
  value: T | null | undefined,
  inputName: string,
): T {
  if (value === null || value === undefined) {
    throw new QueryInputError(inputName);
  }
  return value;
}
