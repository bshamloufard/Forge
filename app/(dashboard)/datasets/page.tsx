import type { Metadata } from "next";
import { DatasetsPage } from "@/app/_components/forge-product";

export const metadata: Metadata = {
  title: "Data"
};

export default function Page() {
  return <DatasetsPage />;
}
