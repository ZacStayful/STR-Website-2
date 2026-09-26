"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";

/**
 * Deletes a saved report. Its author may, and so may the account owner it
 * belongs to — a team's reports are the owner's. Anyone else matches no row.
 * A pipeline row that linked to it forgets the link, so its deal offers a new
 * report instead of a dead "Open full report".
 */
export async function deleteReportAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  if (hasServiceRole()) {
    const admin = createAdminClient();
    const { data } = await admin.from("saved_searches").delete().eq("id", id).or(`user_id.eq.${user.id},owner_id.eq.${user.id}`).select("id");
    if ((data ?? []).length > 0) {
      const { error } = await admin.from("checked_listings").update({ analysed_report_id: null }).eq("analysed_report_id", id);
      if (error) console.error("[reports] unlink failed:", error.message);
    }
  } else {
    await supabase.from("saved_searches").delete().eq("id", id).eq("user_id", user.id);
  }
  revalidatePath("/reports");
  revalidatePath("/my-deals");
}
