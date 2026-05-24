import dynamic from "next/dynamic";

function ProbePageShell() {
  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">
      <p className="flex min-h-[50dvh] items-center justify-center text-sm text-neutral-300">
        렌더 점검 불러오는 중…
      </p>
    </main>
  );
}

const WheelRenderProbeClient = dynamic(() => import("./WheelRenderProbeClient"), {
  ssr: false,
  loading: () => <ProbePageShell />,
});

export default function WheelRenderProbePage() {
  return <WheelRenderProbeClient />;
}
