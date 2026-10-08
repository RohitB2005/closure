import { applicants, jobs, role } from "@/lib/closure";
import CloseRole from "./CloseRole";

export default function Home() {
  return <CloseRole role={role} applicants={applicants} jobs={jobs} />;
}
