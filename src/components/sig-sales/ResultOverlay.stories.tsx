import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import ResultOverlay from "./ResultOverlay";

const meta: Meta<typeof ResultOverlay> = {
  title: "SigSales/ResultOverlay",
  component: ResultOverlay,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof ResultOverlay>;

const sampleSignUrls = [
  "https://picsum.photos/id/1015/400/400",
  "https://picsum.photos/id/237/400/400",
  "https://picsum.photos/id/180/400/400",
];

function SpinAndResultDemoStory() {
  const [visible, setVisible] = useState(false);
  const [signImageUrl, setSignImageUrl] = useState("");
  const [isSpinning, setIsSpinning] = useState(false);

  const simulateSpin = () => {
    setIsSpinning(true);
    setVisible(false);

    setTimeout(() => {
      const randomUrl = sampleSignUrls[Math.floor(Math.random() * sampleSignUrls.length)];
      setSignImageUrl(randomUrl);
      setIsSpinning(false);
      setVisible(true);
    }, 2800);
  };

  return (
    <div style={{ width: "820px", height: "620px", position: "relative", border: "2px dashed #ccc", borderRadius: "12px" }}>
      <div style={{ textAlign: "center", padding: "20px" }}>
        <button
          onClick={simulateSpin}
          disabled={isSpinning}
          style={{
            padding: "16px 32px",
            fontSize: "18px",
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: isSpinning ? "not-allowed" : "pointer",
          }}
        >
          {isSpinning ? "🎰 회전 중..." : "🎰 회전 시작 (데모)"}
        </button>
        <p style={{ marginTop: "12px", color: "#666" }}>3초 후 결과 + 시그 이미지 표시</p>
      </div>

      {isSpinning && (
        <div
          style={{
            position: "absolute",
            top: "45%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: "18px",
            color: "#888",
          }}
        >
          회전판 애니메이션 시뮬레이션 중...
        </div>
      )}

      <ResultOverlay
        visible={visible}
        signImageUrl={signImageUrl}
        selectedSigs={[]}
        soldOutStampUrl="/images/sigs/dummy-sig.svg"
        oneShot={null}
        showOneShotReveal={true}
      />
    </div>
  );
}

export const SpinAndResultDemo: Story = {
  render: () => <SpinAndResultDemoStory />,
};

