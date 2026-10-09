import { redirect } from "next/navigation";
import { RootAuthForward } from "./root-auth-forward";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : null;
  const hash = typeof params.token_hash === "string" ? params.token_hash : null;
  if (code) redirect("/auth/callback?flow=recovery&code=" + encodeURIComponent(code));
  if (hash && params.type === "recovery") {
    redirect("/auth/callback?flow=recovery&type=recovery&token_hash="+encodeURIComponent(hash));
  }
  return <RootAuthForward />;
}
