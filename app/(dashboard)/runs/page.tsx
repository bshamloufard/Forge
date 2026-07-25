import type { Metadata } from "next";
import { TrainPage } from "@/app/_components/forge-product";

export const metadata: Metadata = {
  title: "Train"
};

export default function Page() {
  return <TrainPage />;
}
