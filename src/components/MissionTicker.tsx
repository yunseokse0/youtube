import React, { useEffect, useRef } from "react";
import { MissionItem } from "@/lib/state";

const MissionTicker = ({ missions, fontSize = 16 }: { missions: MissionItem[]; fontSize?: number }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const containerWidth = container.offsetWidth;
    const contentWidth = content.scrollWidth;

    if (contentWidth <= containerWidth) return;

    let position = containerWidth;
    const speed = 1; // pixels per frame
    const delay = 2000; // 2 second delay before starting

    const animate = () => {
      if (position < -contentWidth) {
        position = containerWidth;
        setTimeout(() => {
          requestAnimationFrame(animate);
        }, delay);
      } else {
        position -= speed;
        content.style.transform = `translateX(${position}px)`;
        requestAnimationFrame(animate);
      }
    };

    const startAnimation = () => {
      setTimeout(() => {
        requestAnimationFrame(animate);
      }, delay);
    };

    startAnimation();

    return () => {
      // Cleanup if component unmounts
    };
  }, [missions]);

  if (!missions.length) return null;

  return (
    <div 
      ref={containerRef}
      className="fixed top-4 left-0 right-0 overflow-hidden bg-black/50 backdrop-blur-sm"
      style={{ fontSize }}
    >
      <div 
        ref={contentRef}
        className="whitespace-nowrap py-2 px-4 inline-block"
      >
        <span className="text-amber-400 font-bold mr-8">🎯 SPECIAL MISSIONS</span>
        {missions.map((mission, index) => (
          <span key={mission.id} className="text-white mx-6">
            <span className={mission.isHot ? "text-red-400 font-bold animate-pulse" : ""}>
              {mission.isHot && "🔥 "}
              {mission.title}
            </span>
            <span className="text-amber-400 font-mono font-bold ml-2">
              {mission.price}
            </span>
            {index < missions.length - 1 && <span className="text-stone-500 mx-4">•</span>}
          </span>
        ))}
        <span className="text-stone-500 ml-6">STREAMER CONDITIONS APPLY</span>
      </div>
    </div>
  );
};

export default MissionTicker;