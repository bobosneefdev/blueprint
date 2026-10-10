import { redirect } from "@sveltejs/kit";

export const POST = ({ cookies }) => {
  cookies.delete("session", { path: "/" });
  redirect(303, "/auth/login");
};
