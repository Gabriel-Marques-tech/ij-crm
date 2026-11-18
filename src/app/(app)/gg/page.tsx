import { redirect } from "next/navigation";
import { HREF_GG } from "@/components/shell/nav-config";

export default function GG() {
  redirect(HREF_GG);
}
