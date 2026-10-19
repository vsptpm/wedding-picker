import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { siteSubtitle, siteTitle } from "@/lib/site";
import Gallery from "./Gallery";

export default async function Home() {
  if (!(await currentUser())) redirect("/login");
  return <Gallery title={siteTitle()} subtitle={siteSubtitle()} />;
}
