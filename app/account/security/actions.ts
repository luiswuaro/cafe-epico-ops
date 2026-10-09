"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/src/infrastructure/auth/server";

export async function changeAccountPassword(formData: FormData) {
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (next.length < 12 || next.length > 128 || next !== confirmation || current === next) {
    redirect("/account/security?error=validation");
  }
  const supabase = await createSupabaseServerClient();
  const {data:{user}} = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");
  const {error:verifyError,data:verified} = await supabase.auth.signInWithPassword({email:user.email,password:current});
  if (verifyError || verified.user?.id !== user.id) redirect("/account/security?error=current");
  const {error} = await supabase.auth.updateUser({password:next});
  if (error) redirect("/account/security?error=provider");
  redirect("/account/security?changed=1");
}
