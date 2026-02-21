import React, { useEffect, useRef } from "react";
import { MissionItem } from "@/lib/state";

const MissionTicker = ({ missions, fontSize = 16 }: { missions: MissionItem[]; fontSize?: number }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const duplicateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    const duplicate = duplicateRef.current;
    if (!container || !content || !duplicate) return;

    const contentWidth = content.scrollWidth;
    const speed = 2; // pixels per frame - faster for electronic display feel
    
    // Create seamless loop by duplicating content
    duplicate.innerHTML = content.innerHTML;
    
    let position = 0;
    let duplicatePosition = contentWidth;

    const animate = () => {
      position -= speed;
      duplicatePosition -= speed;
      
      // Reset positions when content goes off screen
      if (position <= -contentWidth) {
        position = contentWidth;
      }
      if (duplicatePosition <= -contentWidth) {
        duplicatePosition = contentWidth;
      }
      
      content.style.transform = `translateX(${position}px)`;
      duplicate.style.transform = `translateX(${duplicatePosition}px)`;
      
      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);

    return () => {
      // Cleanup if component unmounts
    };
  }, [missions]);

  if (!missions.length) return null;

  return (
    <div 
      ref={containerRef}
      className="fixed top-4 left-0 right-0 overflow-hidden bg-black/80 backdrop-blur-sm"
      style={{ fontSize }}
    >
      <div className="relative w-full h-12">
        <div 
          ref={contentRef}
          className="absolute top-0 left-0 whitespace-nowrap py-2 px-4 inline-block"
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
        <div 
          ref={duplicateRef}
          className="absolute top-0 left-0 whitespace-nowrap py-2 px-4 inline-block"
        />
      </div>
    </div>
  );
};

export default MissionTicker;