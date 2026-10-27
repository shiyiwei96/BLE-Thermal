//热像判别
export interface RuleResult {
  label: string;
  box: { x: number; y: number; w: number; h: number };
  ratio: number;
}

export interface RuleOutput {
  status: string;
  hotRatio: number;
  results: RuleResult[];
  hasAnimal: boolean;
}

const THRESH_VAL = 150; // 你的二值化阈值（可根据实际情况调）
const TOTAL_PIXELS = 32 * 24;

// 核心分析函数
export function classifyThermalByRule(grayImg: number[]): RuleOutput {
  // 1. 二值化
  const binaryImg = grayImg.map(v => v > THRESH_VAL);

  // 2. 连通域分析（相当于 cv2.findContours）
  const visited = new Uint8Array(TOTAL_PIXELS);
  const contours: { x: number, y: number, w: number, h: number, area: number, solidity: number }[] = [];

  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 32; x++) {
      const idx = y * 32 + x;
      if (binaryImg[idx] && !visited[idx]) {
        // BFS 找连通区域
        const queue = [idx];
        visited[idx] = 1;
        let minX = x, maxX = x, minY = y, maxY = y;
        let area = 0;
        const points: {x: number, y: number}[] = [];

        while (queue.length > 0) {
          const cur = queue.shift()!;
          const cx = cur % 32, cy = Math.floor(cur / 32);
          area++;
          points.push({x: cx, y: cy});

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // 8邻域搜索
          const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
          for (const [dx, dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < 32 && ny >= 0 && ny < 24) {
              const nIdx = ny * 32 + nx;
              if (binaryImg[nIdx] && !visited[nIdx]) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
        }

        // 计算 Solidy (凸包实心度) 的简单近似：面积 / 外接矩形面积
        // （注意：严格凸包计算在 JS 里很复杂，这里用 bounding box 面积代替，效果类似）
        const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
        const solidity = area / boxArea;

        contours.push({
          x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
          area, solidity
        });
      }
    }
  }

  const hotPixels = binaryImg.filter(v => v).length;
  const hotRatio = hotPixels / TOTAL_PIXELS;

  // 预扫描：是否有长宽比 > 1.5 的设备（PT/PB）
  let hasPtPb = false;
  for (const c of contours) {
    if (c.area / TOTAL_PIXELS < 0.005) continue;
    const aspectRatio = c.h / c.w;
    if (aspectRatio > 1.5) {
      hasPtPb = true;
      break;
    }
  }

  // 正式分类
  const results: RuleResult[] = [];
  let maxHotRatio = 0;
  let hasAnimal = false;

  for (const c of contours) {
    const areaRatio = c.area / TOTAL_PIXELS;
    if (areaRatio < 0.005) continue; // 过滤太小噪点

    const aspectRatio = c.h / c.w;
    let label = "Unknown";

    // 规则 1：电缆沟
    if (hotRatio > 0.40) {
      if (aspectRatio < 1.5 && !hasPtPb) {
        label = "Animal";
      } else {
        label = "PowerCable";
      }
    } 
    // 规则 2：PT/PB (长条设备)
    else if (aspectRatio > 1.5) {
      label = "Ring (PT/PB)";
    } 
    // 规则 3：动物
    else if (c.solidity > 0.75 && areaRatio > 0.01) {
      // 注意：Python 里的凸包实心度通常 >0.85，但 JS 用矩形近似，阈值稍微放低
      if (!hasPtPb) {
        label = "Animal";
        hasAnimal = true;
      }
    }

    if (label !== "Unknown") {
      results.push({
        label,
        box: { x: c.x, y: c.y, w: c.w, h: c.h },
        ratio: areaRatio
      });
    }

    if (areaRatio > maxHotRatio) maxHotRatio = areaRatio;
  }

  return {
    status: results.length > 1 ? "Multi" : (results[0]?.label || "Unknown"),
    hotRatio,
    results,
    hasAnimal
  };
}


