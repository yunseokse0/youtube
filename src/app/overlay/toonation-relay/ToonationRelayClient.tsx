"use client";

import ToonationBrowserRelay from "@/components/ToonationBrowserRelay";

type Props = {
  userId: string;
  linkKey: string;
  ownerName: string;
};

export default function ToonationRelayClient({ userId, linkKey, ownerName }: Props) {
  return (
    <main style={{ minHeight: "100vh", background: "#000" }}>
      <ToonationBrowserRelay
        userId={userId}
        linkKey={linkKey}
        ownerName={ownerName}
        enabled
        hidden={false}
      />
    </main>
  );
}
