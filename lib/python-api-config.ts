export function pythonApiBase() {
  const internalHostport = process.env.API_INTERNAL_HOSTPORT?.trim();
  if (internalHostport) {
    return `http://${internalHostport}`.replace(/\/$/, "");
  }

  return (
    process.env.API_INTERNAL_BASE_URL ||
    (process.env.APP_ENV === "production"
      ? ""
      : process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000")
  ).replace(/\/$/, "");
}
