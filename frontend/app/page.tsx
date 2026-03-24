import { auth } from "@/auth";
import { LandingSignIn } from "@/components/LandingSignIn";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }
  return <LandingSignIn />;
}
