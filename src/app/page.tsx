import { applicants, jobs, role } from "@/lib/closure";
import App from "./App";

export default function Home() {
  return <App role={role} applicants={applicants} jobs={jobs} />;
}
