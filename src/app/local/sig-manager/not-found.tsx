export default function LocalSigManagerNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#2a241c] px-6 text-center text-amber-50">
      <div className="max-w-md space-y-3">
        <h1 className="text-xl font-bold">로컬 전용 페이지</h1>
        <p className="text-sm text-amber-100/80">
          Final Castle Local Signature Manager는 localhost 또는 LAN 개발 환경에서만 사용할 수 있습니다.
        </p>
        <p className="text-xs text-amber-200/60">
          로컬에서 <code className="text-amber-100">npm run dev</code> 후{" "}
          <code className="text-amber-100">/local/sig-manager</code> 로 접속하세요.
        </p>
      </div>
    </main>
  );
}
