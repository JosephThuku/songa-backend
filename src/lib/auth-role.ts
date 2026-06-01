/** App roles — `admin` is seed/login only, not available on public register. */
export type Role = "passenger" | "driver" | "admin";

export const PUBLIC_REGISTER_ROLES = ["passenger", "driver"] as const;
export type PublicRegisterRole = (typeof PUBLIC_REGISTER_ROLES)[number];

export function isPublicRegisterRole(role: string): role is PublicRegisterRole {
  return role === "passenger" || role === "driver";
}
