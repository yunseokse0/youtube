import ToonationRelayClient from "./ToonationRelayClient";

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function pickParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return String(v[0] || "").trim();
  return String(v || "").trim();
}

export default function ToonationRelayPage({ searchParams }: PageProps) {
  const userId = pickParam(searchParams?.u) || pickParam(searchParams?.user) || "finalent";
  const linkKey =
    pickParam(searchParams?.key) ||
    pickParam(searchParams?.linkKey) ||
    pickParam(searchParams?.alertboxUrl);
  const ownerName = pickParam(searchParams?.owner) || pickParam(searchParams?.ownerName);

  return (
    <main style={{ minHeight: "100vh", background: "#000" }}>
      <ToonationRelayClient userId={userId} linkKey={linkKey} ownerName={ownerName} />
    </main>
  );
}
