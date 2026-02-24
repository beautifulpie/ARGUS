import { useRef, useEffect, useState } from 'react';
import { DetectedObject, ObjectClass } from '../types';
import bgMap from '../../assets/88d1cda71c36b8987765afc7740f42ee9bdd5be4.png';

interface LidarSpatialViewProps {
  objects: DetectedObject[];
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
}

const CLASS_COLORS: Record<ObjectClass, string> = {
  HELICOPTER: '#f59e0b', // amber
  UAV: '#ef4444', // red
  HIGHSPEED: '#d946ef', // fuchsia
  BIRD_FLOCK: '#9ca3af', // gray
  BIRD: '#6b7280', // dark gray
  CIVIL_AIR: '#3b82f6', // blue
  FIGHTER: '#dc2626', // dark red
};

const CLASS_NAMES_KR: Record<ObjectClass, string> = {
  HELICOPTER: '헬기',
  UAV: '무인기',
  HIGHSPEED: '고속기',
  BIRD_FLOCK: '새떼',
  BIRD: '새',
  CIVIL_AIR: '민간기',
  FIGHTER: '전투기',
};

export function LidarSpatialView({ objects, selectedObjectId, onSelectObject }: LidarSpatialViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [isImageLoaded, setIsImageLoaded] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.src = bgMap;
    img.onload = () => {
      bgImageRef.current = img;
      setIsImageLoaded(true);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = 2.8; // pixels per meter

    // Clear canvas & Draw Background
    if (bgImageRef.current) {
      // Draw image with preserved aspect ratio (cover mode)
      const img = bgImageRef.current;
      const imgAspect = img.width / img.height;
      const canvasAspect = width / height;
      
      let drawWidth, drawHeight, offsetX, offsetY;
      
      if (imgAspect > canvasAspect) {
        // Image is wider - fit to height and crop sides
        drawHeight = height;
        drawWidth = height * imgAspect;
        offsetX = (width - drawWidth) / 2;
        offsetY = 0;
      } else {
        // Image is taller - fit to width and crop top/bottom
        drawWidth = width;
        drawHeight = width / imgAspect;
        offsetX = 0;
        offsetY = (height - drawHeight) / 2;
      }
      
      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
      // Dark overlay for contrast
      ctx.fillStyle = 'rgba(11, 15, 20, 0.85)';
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(0, 0, width, height);
    }

    // Draw grid
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.08)';
    ctx.lineWidth = 1;
    for (let i = -100; i <= 100; i += 10) {
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(centerX + i * scale, 0);
      ctx.lineTo(centerX + i * scale, height);
      ctx.stroke();
      
      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(0, centerY + i * scale);
      ctx.lineTo(width, centerY + i * scale);
      ctx.stroke();
    }

    // Draw range rings
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.15)';
    ctx.lineWidth = 1.5;
    [25, 50, 75, 100].forEach(radius => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * scale, 0, Math.PI * 2);
      ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(6, 182, 212, 0.4)';
      ctx.font = '14px monospace';
      ctx.fillText(`${radius}m`, centerX + 5, centerY - radius * scale + 15);
    });

    // Draw center crosshair (sensor position)
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - 10, centerY);
    ctx.lineTo(centerX + 10, centerY);
    ctx.moveTo(centerX, centerY - 10);
    ctx.lineTo(centerX, centerY + 10);
    ctx.stroke();

    // Draw corner brackets at sensor
    const bracketSize = 20;
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
    ctx.lineWidth = 2;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(centerX - bracketSize, centerY - bracketSize + 5);
    ctx.lineTo(centerX - bracketSize, centerY - bracketSize);
    ctx.lineTo(centerX - bracketSize + 5, centerY - bracketSize);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(centerX + bracketSize - 5, centerY - bracketSize);
    ctx.lineTo(centerX + bracketSize, centerY - bracketSize);
    ctx.lineTo(centerX + bracketSize, centerY - bracketSize + 5);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(centerX - bracketSize, centerY + bracketSize - 5);
    ctx.lineTo(centerX - bracketSize, centerY + bracketSize);
    ctx.lineTo(centerX - bracketSize + 5, centerY + bracketSize);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(centerX + bracketSize - 5, centerY + bracketSize);
    ctx.lineTo(centerX + bracketSize, centerY + bracketSize);
    ctx.lineTo(centerX + bracketSize, centerY + bracketSize - 5);
    ctx.stroke();

    // Draw objects
    objects.forEach(obj => {
      const x = centerX + obj.position.x * scale;
      const y = centerY - obj.position.y * scale; // Invert Y for screen coords
      const color = CLASS_COLORS[obj.class];
      const isSelected = obj.id === selectedObjectId;
      const isHighRisk = obj.riskLevel === 'HIGH' || obj.riskLevel === 'CRITICAL';
      const isCandidate = obj.status === 'CANDIDATE';

      // Draw track history trail
      if (obj.trackHistory.length > 1) {
        ctx.strokeStyle = isCandidate ? '#555' : color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = isCandidate ? 0.2 : 0.3;
        ctx.beginPath();
        const firstPoint = obj.trackHistory[0];
        ctx.moveTo(centerX + firstPoint.x * scale, centerY - firstPoint.y * scale);
        obj.trackHistory.forEach(point => {
          ctx.lineTo(centerX + point.x * scale, centerY - point.y * scale);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Draw predicted path (Dashed line)
      if (obj.predictedPath && obj.predictedPath.length > 0) {
        ctx.strokeStyle = isCandidate ? '#777' : color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]); // Dashed line
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y); // Start from current position
        obj.predictedPath.forEach(point => {
          ctx.lineTo(centerX + point.x * scale, centerY - point.y * scale);
        });
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash
        ctx.globalAlpha = 1;
      }

      // Draw velocity vector (skip for candidates if desired, but good to show prediction)
      const arrowLength = obj.speed * scale * 3;
      const arrowAngle = Math.atan2(-obj.velocity.y, obj.velocity.x); // Negative Y for screen
      const arrowEndX = x + Math.cos(arrowAngle) * arrowLength;
      const arrowEndY = y + Math.sin(arrowAngle) * arrowLength;

      ctx.strokeStyle = isCandidate ? '#777' : color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = isCandidate ? 0.4 : 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(arrowEndX, arrowEndY);
      ctx.stroke();

      // Arrow head
      const headSize = 8;
      ctx.beginPath();
      ctx.moveTo(arrowEndX, arrowEndY);
      ctx.lineTo(
        arrowEndX - headSize * Math.cos(arrowAngle - Math.PI / 6),
        arrowEndY - headSize * Math.sin(arrowAngle - Math.PI / 6)
      );
      ctx.moveTo(arrowEndX, arrowEndY);
      ctx.lineTo(
        arrowEndX - headSize * Math.cos(arrowAngle + Math.PI / 6),
        arrowEndY - headSize * Math.sin(arrowAngle + Math.PI / 6)
      );
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Draw bounding box
      const boxWidth = obj.size.length * scale;
      const boxHeight = obj.size.width * scale;
      
      ctx.strokeStyle = isCandidate ? '#aaa' : color;
      ctx.lineWidth = isSelected ? 3 : 2;
      
      if (isCandidate) {
        ctx.setLineDash([2, 2]); // Dashed box for candidates
      }

      if (isHighRisk && !isCandidate) {
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 15;
      }
      if (isSelected) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
      }

      ctx.strokeRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight);
      ctx.shadowBlur = 0;
      ctx.setLineDash([]); // Reset

      // Draw object marker (center dot)
      ctx.fillStyle = isCandidate ? '#aaa' : color;
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw status indicator (NEW/LOST)
      if (obj.status === 'NEW') {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.stroke();
      } else if (obj.status === 'LOST') {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(x - 12, y - 12);
        ctx.lineTo(x + 12, y + 12);
        ctx.moveTo(x + 12, y - 12);
        ctx.lineTo(x - 12, y + 12);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (isCandidate) {
        // Draw ? for candidate
        ctx.fillStyle = '#fff';
        ctx.font = '16px monospace';
        ctx.fillText('?', x - 4, y - boxHeight/2 - 5);
      }

      // Draw ID label
      ctx.fillStyle = isCandidate ? '#aaa' : '#fff';
      ctx.font = '15px monospace';
      ctx.fillText(obj.id, x + boxWidth / 2 + 5, y - boxHeight / 2 - 5);

      // Draw class and confidence
      ctx.fillStyle = isCandidate ? '#aaa' : color;
      ctx.font = '14px monospace';
      ctx.fillText(
        `${CLASS_NAMES_KR[obj.class]} ${obj.confidence.toFixed(0)}%`,
        x + boxWidth / 2 + 5,
        y - boxHeight / 2 + 12
      );
      
      if (isCandidate) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = '12px monospace';
        ctx.fillText('(신호 손실 - 추적 유지 )', x + boxWidth / 2 + 5, y - boxHeight / 2 + 26);
      }
    });
  }, [objects, selectedObjectId, isImageLoaded]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = 2.8;

    // Find clicked object
    let clickedObject: DetectedObject | null = null;
    let minDistance = Infinity;

    objects.forEach(obj => {
      const x = centerX + obj.position.x * scale;
      const y = centerY - obj.position.y * scale;
      const distance = Math.sqrt((clickX - x) ** 2 + (clickY - y) ** 2);

      // Check if click is within bounding box or near center
      const boxWidth = obj.size.length * scale;
      const boxHeight = obj.size.width * scale;
      const inBox = 
        clickX >= x - boxWidth / 2 && 
        clickX <= x + boxWidth / 2 &&
        clickY >= y - boxHeight / 2 &&
        clickY <= y + boxHeight / 2;

      if ((inBox || distance < 20) && distance < minDistance) {
        clickedObject = obj;
        minDistance = distance;
      }
    });

    if (clickedObject) {
      onSelectObject(clickedObject.id);
    } else {
      onSelectObject(null);
    }
  };

  return (
    <div className="h-full w-full bg-[#0a0d12] border-r border-cyan-950/50 flex flex-col relative">
      {/* Corner brackets */}
      <div className="absolute top-4 left-4 w-6 h-6 border-l-2 border-t-2 border-cyan-500/40" />
      <div className="absolute top-4 right-4 w-6 h-6 border-r-2 border-t-2 border-cyan-500/40" />
      <div className="absolute bottom-4 left-4 w-6 h-6 border-l-2 border-b-2 border-cyan-500/40" />
      <div className="absolute bottom-4 right-4 w-6 h-6 border-r-2 border-b-2 border-cyan-500/40" />

      {/* Header */}
      <div className="px-6 py-4 border-b border-cyan-950/50">
        <h2 className="text-lg font-semibold text-cyan-400 uppercase tracking-wider">
          RADAR 공간 뷰
        </h2>
        <p className="text-sm text-gray-500 mt-1 font-mono">전방위 탐지 필드 (PPI)</p>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center p-4">
        <canvas
          ref={canvasRef}
          width={560}
          height={680}
          onClick={handleCanvasClick}
          className="cursor-crosshair"
        />
      </div>

      {/* Legend */}
      <div className="px-6 py-3 border-t border-cyan-950/50 flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#ef4444]" />
            <span className="text-gray-400">무인기</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#dc2626]" />
            <span className="text-gray-400">전투기</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#d946ef]" />
            <span className="text-gray-400">고속기</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#3b82f6]" />
            <span className="text-gray-400">민간기</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#f59e0b]" />
            <span className="text-gray-400">헬기</span>
          </div>
        </div>
        <span className="text-gray-500 font-mono">{objects.length} 객체</span>
      </div>
    </div>
  );
}
