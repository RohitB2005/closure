import { applicants, jobs, role, type ClosureResult } from "@/lib/closure";
import { llmConfigured } from "@/lib/llm";
import demoRun from "@/data/demo-run.json";
import App from "./App";

export default function Home() {
  return <App role={role} applicants={applicants} jobs={jobs} recorded={demoRun.results as ClosureResult[]} serverKey={llmConfigured()} />;
}
