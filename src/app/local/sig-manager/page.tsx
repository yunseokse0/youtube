import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isLocalSigManagerAllowed } from "@/lib/local-dev-host";
import SigManagerClient from "./SigManagerClient";

export const dynamic = "force-dynamic";

export default function LocalSigManagerPage() {
  const host = headers().get("host") || headers().get("x-forwarded-host") || "";
  if (!isLocalSigManagerAllowed(host)) {
    notFound();
  }

  return <SigManagerClient />;
}
