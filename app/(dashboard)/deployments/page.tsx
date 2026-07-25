import type { Metadata } from "next";
import { DeployPage } from "@/app/_components/forge-product";

export const metadata: Metadata = {
  title: "Deploy"
};

export default function Page() {
  return <DeployPage />;
}
