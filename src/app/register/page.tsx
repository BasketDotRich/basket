import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getUser } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";

export default async function RegisterPage(props: PageProps<"/register">) {
  const user = await getUser();
  if (user) redirect("/dashboard");
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  return (
    <div className="flex min-h-[70vh] items-center px-4 py-12">
      <AuthForm mode="register" googleEnabled={googleEnabled()} oauthError={error} />
    </div>
  );
}
