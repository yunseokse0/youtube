import { notFound } from "next/navigation";
import OverlayDevHubClient from "./OverlayDevHubClient";

/** 개발 전용 — 프로덕션 빌드에서는 404 */
export default function OverlayDevHubPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <OverlayDevHubClient />;
}
