import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getUser } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";

export default async function LoginPage(props: PageProps<"/login">) {
  const user = await getUser();
  if (user) redirect("/dashboard");
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  return (
    <div className="flex min-h-[70vh] items-center px-4 py-12">
      <AuthForm mode="login" googleEnabled={googleEnabled()} oauthError={error} />
    </div>
  );
}
