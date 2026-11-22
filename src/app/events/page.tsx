import { redirect } from "next/navigation";

// The event list lives on the home page; /events used to 404.
export default function EventsIndexPage() {
  redirect("/");
}
