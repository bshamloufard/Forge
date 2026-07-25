import type { Metadata } from "next";
import { EvaluatePage } from "@/app/_components/forge-product";

export const metadata: Metadata = {
  title: "Evaluate"
};

export default function Page() {
  return <EvaluatePage />;
}
